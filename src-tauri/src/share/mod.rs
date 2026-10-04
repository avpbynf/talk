//! Share this PC: the local whisper engine, served to other machines over the
//! same HTTP API as Talk-Server.

mod announce;
mod api;
mod audio;
mod formats;
mod pairing;
mod priority;
mod tokens;

use crate::database::{Database, ShareDevice};
use crate::discovery::Discovery;
use crate::settings;
use crate::transcription::Transcript;
use crate::{AcceleratorBackend, AppState};
use announce::Announcement;
use api::{ApiState, ShareBackend, TranscribeError};
use pairing::{PairingStore, PendingPairing};
use parking_lot::Mutex;
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, EventTarget, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareState {
    Off,
    Serving,
    PortBusy,
    Error,
}

/// What the Transcription page shows about sharing
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub enabled: bool,
    pub port: u16,
    pub state: ShareState,
    /// Where other machines reach this one, when there is a network to be on
    pub address: Option<String>,
    /// Why the server is not serving
    pub message: Option<String>,
    /// Why other machines will not find this one on their own
    pub announce_error: Option<String>,
    pub model: Option<String>,
    pub pairing_locked: bool,
}

struct Status {
    state: ShareState,
    message: Option<String>,
    announce_error: Option<String>,
    address: Option<String>,
}

impl Status {
    fn off() -> Self {
        Self {
            state: ShareState::Off,
            message: None,
            announce_error: None,
            address: None,
        }
    }
}

struct Running {
    task: tauri::async_runtime::JoinHandle<()>,
    announcement: Option<Announcement>,
    port: u16,
}

pub struct ShareManager {
    pairing: Arc<Mutex<PairingStore>>,
    // Starting and stopping take turns, so a quick off and on cannot meet the
    // port the first one is still letting go of.
    running: tokio::sync::Mutex<Option<Running>>,
    status: Mutex<Status>,
}

impl Default for ShareManager {
    fn default() -> Self {
        Self {
            pairing: Arc::new(Mutex::new(PairingStore::default())),
            running: tokio::sync::Mutex::new(None),
            status: Mutex::new(Status::off()),
        }
    }
}

/// The application, as the routes see it
struct AppBackend {
    app: AppHandle,
    pending_count: AtomicUsize,
}

impl ShareBackend for AppBackend {
    fn model_id(&self) -> Option<String> {
        self.app.state::<AppState>().current_model.lock().clone()
    }

    fn device(&self) -> String {
        match settings::read(|s| s.accelerator_backend) {
            AcceleratorBackend::Vulkan => "vulkan".to_string(),
            AcceleratorBackend::Cpu => "cpu".to_string(),
        }
    }

    fn transcribe(
        &self,
        audio: &[f32],
        language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<Transcript, TranscribeError> {
        // The same lock a dictation on this PC takes. The request already
        // waited for a quiet moment, but a dictation can start while it sat
        // on the lock or while whisper runs, and that one wins.
        let state = self.app.state::<AppState>();
        let engine = state.whisper_engine.lock();
        let Some(engine) = engine.as_ref() else {
            return Err(TranscribeError::NoModel);
        };
        if local_busy(&self.app) {
            return Err(TranscribeError::Busy);
        }

        let aborted = Arc::new(AtomicBool::new(false));
        let should_abort: Box<dyn FnMut() -> bool> = {
            let app = self.app.clone();
            let aborted = aborted.clone();
            Box::new(move || {
                let busy = local_busy(&app);
                if busy {
                    aborted.store(true, Ordering::SeqCst);
                }
                busy
            })
        };
        let result = engine.transcribe_segments(audio, language, prompt, should_abort);
        if aborted.load(Ordering::SeqCst) {
            return Err(TranscribeError::Busy);
        }
        result.map_err(|e| TranscribeError::Failed(e.to_string()))
    }

    fn local_busy(&self) -> bool {
        local_busy(&self.app)
    }

    fn check_token(&self, token: &str, count_usage: bool) -> Result<bool, String> {
        tokens::verify(&self.app.state::<Database>(), token, count_usage)
    }

    fn mint_token(&self, name: &str) -> Result<String, String> {
        let token = tokens::mint(&self.app.state::<Database>(), name)?;
        let _ = self.app.emit("share-devices-changed", ());
        Ok(token)
    }

    fn pairing_changed(&self, pending: Vec<PendingPairing>) {
        let before = self.pending_count.swap(pending.len(), Ordering::SeqCst);
        // Somebody is waiting on a code that only this window shows, so the
        // window comes up if it was sitting in the tray
        if pending.len() > before {
            if let Some(window) = self.app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
            }
        }
        let _ = self
            .app
            .emit_to(EventTarget::webview_window("main"), "share-pairing-changed", pending);
    }

    fn pairing_locked(&self) {
        refresh_in_background(&self.app);
    }
}

fn local_busy(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let recording = state.phase.lock().active();
    priority::local_is_busy(recording, state.jobs_in_flight.load(Ordering::SeqCst))
}

fn current_model(app: &AppHandle) -> Option<String> {
    app.state::<AppState>().current_model.lock().clone()
}

fn bind_failure(port: u16, error: &std::io::Error) -> (ShareState, String) {
    if error.kind() == std::io::ErrorKind::AddrInUse {
        (
            ShareState::PortBusy,
            format!("Port {} is already used by another program. Pick another port.", port),
        )
    } else {
        (
            ShareState::Error,
            format!("Could not listen on port {}: {}", port, error),
        )
    }
}

impl ShareManager {
    pub fn info(&self, app: &AppHandle) -> ShareInfo {
        let (enabled, port) = settings::read(|s| (s.share_enabled, s.share_port));
        let status = self.status.lock();
        ShareInfo {
            enabled,
            port,
            state: status.state,
            address: status.address.clone(),
            message: status.message.clone(),
            announce_error: status.announce_error.clone(),
            model: current_model(app),
            pairing_locked: self.pairing.lock().locked(),
        }
    }

    fn publish(&self, app: &AppHandle) {
        let _ = app.emit("share-status-changed", self.info(app));
    }

    pub fn pending_pairings(&self) -> Vec<PendingPairing> {
        self.pairing.lock().pending()
    }

    /// Start serving on the saved port, replacing a server already running
    pub async fn start(&self, app: &AppHandle) {
        let mut running = self.running.lock().await;
        self.stop_locked(&mut running, app).await;

        let port = settings::read(|s| s.share_port);
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => listener,
            Err(e) => {
                eprintln!("Share: could not listen on port {}: {}", port, e);
                let (state, message) = bind_failure(port, &e);
                *self.status.lock() = Status {
                    state,
                    message: Some(message),
                    ..Status::off()
                };
                drop(running);
                self.publish(app);
                return;
            }
        };

        let backend = Arc::new(AppBackend {
            app: app.clone(),
            pending_count: AtomicUsize::new(0),
        });
        let router = api::router(ApiState::new(backend, self.pairing.clone()));
        let task = tauri::async_runtime::spawn(async move {
            let service = router.into_make_service_with_connect_info::<SocketAddr>();
            if let Err(e) = axum::serve(listener, service).await {
                eprintln!("Share: the server stopped: {}", e);
            }
        });

        let addresses = announce::local_addresses();
        let model = current_model(app);
        let announcement = match Announcement::start(
            port,
            model.as_deref(),
            !self.pairing.lock().locked(),
            &addresses,
        ) {
            Ok(announcement) => Some(announcement),
            Err(e) => {
                eprintln!("Share: could not announce on the network: {}", e);
                None
            }
        };

        let announce_error = announcement.is_none().then(|| {
            if addresses.is_empty() {
                "No network connection found, so other PCs cannot reach this one.".to_string()
            } else {
                "Could not announce this PC on the network. Other PCs can still connect by address."
                    .to_string()
            }
        });
        if let Some(announcement) = &announcement {
            if app.state::<Discovery>().set_own(Some(announcement.fullname().to_string())) {
                let _ = app.emit("servers-changed", app.state::<Discovery>().list());
            }
        }

        *self.status.lock() = Status {
            state: ShareState::Serving,
            message: None,
            announce_error,
            address: addresses.first().map(|ip| format!("http://{}:{}", ip, port)),
        };
        *running = Some(Running { task, announcement, port });
        drop(running);
        self.publish(app);
    }

    pub async fn stop(&self, app: &AppHandle) {
        let mut running = self.running.lock().await;
        self.stop_locked(&mut running, app).await;
        drop(running);
        self.publish(app);
    }

    async fn stop_locked(&self, running: &mut Option<Running>, app: &AppHandle) {
        if let Some(server) = running.take() {
            server.task.abort();
            // Waiting is what frees the port before anyone binds it again
            let _ = server.task.await;
            drop(server.announcement);
            if app.state::<Discovery>().set_own(None) {
                let _ = app.emit("servers-changed", app.state::<Discovery>().list());
            }
        }
        self.pairing.lock().clear();
        let _ = app.emit_to(
            EventTarget::webview_window("main"),
            "share-pairing-changed",
            Vec::<PendingPairing>::new(),
        );
        *self.status.lock() = Status::off();
    }

    /// Announce again with the model and the pairing flag as they are now
    pub async fn refresh_announcement(&self, app: &AppHandle) {
        let running = self.running.lock().await;
        if let Some(server) = running.as_ref() {
            if let Some(announcement) = &server.announcement {
                let result = announcement.update(
                    server.port,
                    current_model(app).as_deref(),
                    !self.pairing.lock().locked(),
                    &announce::local_addresses(),
                );
                if let Err(e) = result {
                    eprintln!("Share: could not update the announcement: {}", e);
                }
            }
        }
        drop(running);
        self.publish(app);
    }
}

fn refresh_in_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<ShareManager>().refresh_announcement(&app).await;
    });
}

/// Tell the network, and the page, that the loaded model changed
pub fn model_changed(app: &AppHandle) {
    refresh_in_background(app);
}

/// Start serving at launch when it was left on
pub fn start_at_launch(app: &AppHandle) {
    if !settings::read(|s| s.share_enabled) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<ShareManager>().start(&app).await;
    });
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
pub fn share_get_status(app: AppHandle, manager: tauri::State<'_, ShareManager>) -> ShareInfo {
    manager.info(&app)
}

#[tauri::command]
pub async fn share_set_enabled(
    enabled: bool,
    app: AppHandle,
    manager: tauri::State<'_, ShareManager>,
) -> Result<ShareInfo, String> {
    settings::update(|s| s.share_enabled = enabled)?;

    if enabled {
        manager.start(&app).await;
    } else {
        manager.stop(&app).await;
    }
    Ok(manager.info(&app))
}

#[tauri::command]
pub async fn share_set_port(
    port: u16,
    app: AppHandle,
    manager: tauri::State<'_, ShareManager>,
) -> Result<ShareInfo, String> {
    if port == 0 {
        return Err("The port must be between 1 and 65535".to_string());
    }
    let enabled = settings::update(|s| {
        s.share_port = port;
        s.share_enabled
    })?
    .value;

    if enabled {
        manager.start(&app).await;
    }
    Ok(manager.info(&app))
}

#[tauri::command]
pub fn share_list_devices(db: tauri::State<'_, Database>) -> Result<Vec<ShareDevice>, String> {
    db.list_share_tokens().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn share_revoke_device(
    id: String,
    app: AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<bool, String> {
    let removed = db.revoke_share_token(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("share-devices-changed", ());
    Ok(removed)
}

#[tauri::command]
pub fn share_pending_pairings(manager: tauri::State<'_, ShareManager>) -> Vec<PendingPairing> {
    manager.pending_pairings()
}
