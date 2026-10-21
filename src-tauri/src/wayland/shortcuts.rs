//! The three shortcuts, bound through the `GlobalShortcuts` portal.
//!
//! The desktop owns the binding: the trigger Talk asks for is a preference it
//! shows the user, who accepts it once in a dialog, and the desktop remembers the
//! answer under the shortcut's id. So the id carries the trigger, and a shortcut
//! changed in the settings is a new id the desktop asks about, rather than an old
//! id it would keep on its old keys.

use super::{registered, runtime};
use ashpd::desktop::global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut};
use ashpd::desktop::{CreateSessionOptions, ResponseError, Session};
use futures::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tokio::sync::{Mutex, OnceCell};

/// Events arriving while a shortcut is being captured in the settings are dropped.
static SUSPENDED: AtomicBool = AtomicBool::new(false);

/// The session holding the shortcuts last bound, and their ids.
static BOUND: Mutex<Option<(Vec<String>, Session<GlobalShortcuts>)>> = Mutex::const_new(None);

/// Where the shortcuts' events are sent.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Bind the stored shortcuts, named `Main`, `Cancel` and `Paste`, in place of
/// whatever was bound.
///
/// The desktop may show its dialog and wait for the user, so this returns at
/// once; a refusal is told on the overlay. Binding the same shortcuts again keeps
/// the session there is rather than asking anything.
pub fn bind(app: &AppHandle, stored: &[(&str, Option<Shortcut>)]) {
    let _ = APP.set(app.clone());
    SUSPENDED.store(false, Ordering::SeqCst);
    let wanted: Vec<(String, String)> = stored
        .iter()
        .filter_map(|(name, shortcut)| {
            let trigger = trigger(&(*shortcut)?)?;
            Some((format!("{}:{trigger}", name.to_lowercase()), trigger))
        })
        .collect();
    let app = app.clone();
    runtime().spawn(async move {
        if let Err(e) = rebind(&wanted).await {
            eprintln!("Global shortcuts unavailable: {e}");
            crate::hotkeys::refuse(&app, "shortcut_refused");
        }
    });
}

/// Stop acting on the shortcuts until the next `bind`, keeping them bound.
///
/// Unbinding would make the desktop ask again when they come back, each time a
/// shortcut field is focused.
pub fn suspend() {
    SUSPENDED.store(true, Ordering::SeqCst);
}

async fn rebind(wanted: &[(String, String)]) -> Result<(), String> {
    let mut bound = BOUND.lock().await;
    let ids: Vec<String> = wanted.iter().map(|(id, _)| id.clone()).collect();
    if bound.as_ref().is_some_and(|(held, _)| *held == ids) {
        return Ok(());
    }
    if let Some((_, session)) = bound.take() {
        let _ = session.close().await;
    }
    if wanted.is_empty() {
        return Ok(());
    }

    let portal = portal().await?;
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|e| e.to_string())?;
    let shortcuts: Vec<NewShortcut> = wanted
        .iter()
        .map(|(id, trigger)| NewShortcut::new(id.as_str(), describe(id)).preferred_trigger(trigger.as_str()))
        .collect();
    let answer = portal
        .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
        .await
        .and_then(|request| request.response());
    match answer {
        Ok(_) => {
            *bound = Some((ids, session));
            Ok(())
        }
        Err(ashpd::Error::Response(ResponseError::Cancelled)) => {
            let _ = session.close().await;
            Err("the user declined them".into())
        }
        Err(e) => {
            let _ = session.close().await;
            Err(e.to_string())
        }
    }
}

/// The portal, opened once along with the task that hands its events over.
async fn portal() -> Result<&'static GlobalShortcuts, String> {
    static PORTAL: OnceCell<GlobalShortcuts> = OnceCell::const_new();
    PORTAL
        .get_or_try_init(|| async {
            registered().await?;
            let portal = GlobalShortcuts::new().await.map_err(|e| e.to_string())?;
            let pressed = portal.receive_activated().await.map_err(|e| e.to_string())?;
            let released = portal.receive_deactivated().await.map_err(|e| e.to_string())?;
            let mut events = futures::stream::select(
                pressed.map(|event| (event.shortcut_id().to_string(), ShortcutState::Pressed)),
                released.map(|event| (event.shortcut_id().to_string(), ShortcutState::Released)),
            );
            runtime().spawn(async move {
                while let Some((id, state)) = events.next().await {
                    dispatch(&id, state);
                }
            });
            Ok(portal)
        })
        .await
}

/// Send an event where the X11 and Windows handler sends it.
///
/// The paste goes out as its shortcut is let go rather than pressed: nothing
/// here can tell when its modifiers are up again, and a paste sent while they are
/// held reaches the window as another command.
fn dispatch(id: &str, state: ShortcutState) {
    let Some(app) = APP.get() else { return };
    if SUSPENDED.load(Ordering::SeqCst) {
        return;
    }
    match (id.split(':').next(), state) {
        (Some("main"), _) => crate::hotkeys::handle_shortcut_event(app, state),
        (Some("cancel"), ShortcutState::Pressed) => crate::hotkeys::cancel(app),
        (Some("paste"), ShortcutState::Released) => crate::hotkeys::paste_last_transcription(app),
        _ => {}
    }
}

/// What the desktop's dialog says each shortcut does, in the interface language.
fn describe(id: &str) -> &'static str {
    let french = crate::settings::read(|s| s.language.as_deref() == Some("fr"));
    match (id.split(':').next(), french) {
        (Some("main"), false) => "Dictate",
        (Some("main"), true) => "Dicter",
        (Some("cancel"), false) => "Cancel the dictation",
        (Some("cancel"), true) => "Annuler la dictée",
        (_, false) => "Paste the last dictation",
        (_, true) => "Coller la dernière dictée",
    }
}

/// The shortcut in the trigger syntax of the XDG shortcuts specification, such
/// as `CTRL+SHIFT+space`, for the keys a shortcut of the settings can name.
fn trigger(shortcut: &Shortcut) -> Option<String> {
    let mut parts: Vec<String> = [
        (Modifiers::CONTROL, "CTRL"),
        (Modifiers::ALT, "ALT"),
        (Modifiers::SHIFT, "SHIFT"),
        (Modifiers::SUPER, "LOGO"),
    ]
    .into_iter()
    .filter(|(modifier, _)| shortcut.mods.contains(*modifier))
    .map(|(_, name)| name.to_string())
    .collect();
    parts.push(keysym_name(shortcut.key)?);
    Some(parts.join("+"))
}

/// The xkb keysym name of a key.
fn keysym_name(code: Code) -> Option<String> {
    let name = match code {
        Code::Space => "space",
        Code::Enter => "Return",
        Code::Tab => "Tab",
        Code::Escape => "Escape",
        Code::Backspace => "BackSpace",
        Code::Delete => "Delete",
        Code::Insert => "Insert",
        Code::Home => "Home",
        Code::End => "End",
        Code::PageUp => "Page_Up",
        Code::PageDown => "Page_Down",
        Code::ArrowUp => "Up",
        Code::ArrowDown => "Down",
        Code::ArrowLeft => "Left",
        Code::ArrowRight => "Right",
        other => {
            // Letters, digits and function keys, which `Code` names `KeyA`, `Digit1`, `F5`.
            let named = format!("{other:?}");
            return if let Some(letter) = named.strip_prefix("Key") {
                Some(letter.to_lowercase())
            } else if let Some(digit) = named.strip_prefix("Digit") {
                Some(digit.to_string())
            } else if named.starts_with('F') && named[1..].parse::<u8>().is_ok() {
                Some(named)
            } else {
                None
            };
        }
    };
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shortcut_reads_in_the_portal_trigger_syntax() {
        let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
        assert_eq!(trigger(&shortcut).as_deref(), Some("CTRL+SHIFT+space"));
        let shortcut = Shortcut::new(Some(Modifiers::SUPER), Code::KeyD);
        assert_eq!(trigger(&shortcut).as_deref(), Some("LOGO+d"));
        let shortcut = Shortcut::new(None, Code::F9);
        assert_eq!(trigger(&shortcut).as_deref(), Some("F9"));
    }
}
