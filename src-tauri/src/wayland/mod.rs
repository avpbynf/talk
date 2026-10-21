//! Shortcuts and text entry on a Wayland session, through the desktop portals.
//!
//! Wayland gives no application a global key grab nor a way to type into another
//! window. Both go through the XDG desktop portal instead: `GlobalShortcuts` for
//! the three shortcuts, and a `RemoteDesktop` session with its clipboard for the
//! text. Each asks the user once, in a dialog of the desktop's own.
//!
//! The portal keeps the user's answers per application id, and an application
//! started outside a sandbox has none until it registers one. Registering needs a
//! desktop file of that name, so one is written in the user's applications folder
//! first, hidden from the menus.
//!
//! Everything here runs on a runtime of its own: the portal connection lives on
//! the runtime it was opened from, and the callers are plain threads as often as
//! tasks of the application's runtime, where waiting on another future would panic.

mod remote;
mod shortcuts;

pub use remote::{press_keys, type_text};
pub use shortcuts::{bind, suspend};

use std::future::Future;
use std::sync::OnceLock;
use tokio::sync::OnceCell;

/// The application id the portal files the user's answers under.
const APP_ID: &str = "com.avpbynf.talk";

/// Whether this session is Wayland, where the X11 paths reach no native window.
pub fn active() -> bool {
    static ACTIVE: OnceLock<bool> = OnceLock::new();
    *ACTIVE.get_or_init(|| {
        std::env::var("XDG_SESSION_TYPE").is_ok_and(|kind| kind == "wayland")
            || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|display| !display.is_empty())
    })
}

/// The runtime every portal call and signal runs on.
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("portal")
            .enable_all()
            .build()
            .expect("the portal runtime starts")
    })
}

/// Run a future on the portal runtime and wait for its answer, from any thread.
fn wait<T: Send + 'static>(work: impl Future<Output = T> + Send + 'static) -> T {
    let (answer, answered) = std::sync::mpsc::sync_channel(1);
    runtime().spawn(async move {
        let _ = answer.send(work.await);
    });
    answered.recv().expect("the portal runtime answers")
}

/// Register the application id with the portal, once, before any other call.
///
/// The registration belongs to the connection, which ashpd shares between every
/// portal it opens, so this is what each of them awaits first.
async fn registered() -> Result<(), String> {
    static REGISTERED: OnceCell<Result<(), String>> = OnceCell::const_new();
    REGISTERED
        .get_or_init(|| async {
            write_desktop_entry().map_err(|e| format!("Failed to write the desktop entry: {e}"))?;
            let id = ashpd::AppID::try_from(APP_ID).map_err(|e| e.to_string())?;
            ashpd::register_host_app(id)
                .await
                .map_err(|e| format!("Failed to register with the desktop portal: {e}"))
        })
        .await
        .clone()
}

/// Write the hidden desktop entry the portal reads the application's name from.
///
/// It points at the running executable, so it is rewritten when that moves, and
/// left alone otherwise.
fn write_desktop_entry() -> std::io::Result<()> {
    let applications = directories::BaseDirs::new()
        .map(|dirs| dirs.data_dir().join("applications"))
        .ok_or_else(|| std::io::Error::other("no home directory"))?;
    let executable = std::env::current_exe()?;
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Talk\nComment=Speech to text\nExec=\"{}\"\nIcon=talk\nNoDisplay=true\n",
        executable.display()
    );
    let path = applications.join(format!("{APP_ID}.desktop"));
    if std::fs::read_to_string(&path).is_ok_and(|written| written == entry) {
        return Ok(());
    }
    crate::atomic_file::write(&path, entry.as_bytes())
}
