//! Text entry through a `RemoteDesktop` portal session and its clipboard.
//!
//! The text goes to the clipboard and a Ctrl+V follows, like on Windows: the
//! portal types by keysym, and the desktop drops a keysym its keyboard layout has
//! no key for, which on a French layout is any capital with an accent. Typing
//! keysyms is kept for a session whose clipboard the user did not share.
//!
//! The session opens at the first paste and stays open, since the clipboard
//! is served from it for as long as Talk owns it. The desktop asks the user once;
//! the token it hands back restores the answer at the next launch without asking,
//! and is renewed at each start.

use super::{registered, wait};
use crate::clipboard::ClipboardError;
use ashpd::desktop::clipboard::{Clipboard, RequestClipboardOptions, SetSelectionOptions};
use ashpd::desktop::remote_desktop::{
    DeviceType, KeyState, NotifyKeyboardKeysymOptions, RemoteDesktop, SelectDevicesOptions, StartOptions,
};
use ashpd::desktop::{CreateSessionOptions, PersistMode, ResponseError, Session};
use ashpd::enumflags2::BitFlags;
use futures::StreamExt;
use parking_lot::Mutex;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// What the clipboard offers its text as.
const TEXT_TYPES: [&str; 3] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];

const KEYSYM_CONTROL: i32 = 0xffe3;
const KEYSYM_SHIFT: i32 = 0xffe1;
const KEYSYM_ALT: i32 = 0xffe9;
const KEYSYM_SUPER: i32 = 0xffeb;
const KEYSYM_V: i32 = 0x76;

/// The open session, once the user has allowed it.
static REMOTE: tokio::sync::Mutex<Option<Remote>> = tokio::sync::Mutex::const_new(None);

/// Paste the text into the focused window, putting the clipboard back after
/// when asked to.
pub fn type_text(text: &str, preserve_clipboard: bool) -> Result<(), ClipboardError> {
    let text = text.to_string();
    wait(entered(async move |remote| {
        if remote.clipboard_enabled {
            remote.paste(text.into_bytes(), preserve_clipboard).await
        } else {
            remote.type_keysyms(&text).await
        }
    }))
}

/// Press a combination such as `Ctrl+Shift+M` in the focused window.
pub fn press_keys(keys: &str) -> Result<(), String> {
    let mut held = Vec::new();
    let mut key = None;
    for part in keys.split('+').map(str::trim) {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => held.push(KEYSYM_CONTROL),
            "alt" => held.push(KEYSYM_ALT),
            "shift" => held.push(KEYSYM_SHIFT),
            "meta" | "win" | "super" => held.push(KEYSYM_SUPER),
            other => key = Some(keysym_of_key(other).ok_or_else(|| format!("Unknown key: {other}"))?),
        }
    }
    let key = key.ok_or_else(|| "No main key found in shortcut".to_string())?;
    wait(entered(async move |remote| remote.chord(&held, key).await)).map_err(|e| e.to_string())
}

/// Run on the open session, opening one first when there is none.
///
/// A session that fails is dropped for the next entry to open another: the
/// desktop ends a session the user revokes, and the token restores a new one
/// without asking when the answer still stands.
async fn entered<T>(work: impl AsyncFnOnce(&Remote) -> Result<T, ClipboardError>) -> Result<T, ClipboardError> {
    let mut slot = REMOTE.lock().await;
    if slot.is_none() {
        *slot = Some(Remote::open().await?);
    }
    let result = work(slot.as_ref().expect("opened just above")).await;
    if result.is_err() {
        *slot = None;
    }
    result
}

struct Remote {
    portal: RemoteDesktop,
    clipboard: Arc<Clipboard>,
    session: Session<RemoteDesktop>,
    clipboard_enabled: bool,
    /// What the clipboard hands out while Talk owns it.
    offered: Arc<Mutex<Vec<u8>>>,
    owned: Arc<AtomicBool>,
    /// How many times a window has fetched what Talk offered.
    fetched: Arc<AtomicU64>,
}

impl Remote {

    async fn open() -> Result<Self, ClipboardError> {
        registered().await.map_err(ClipboardError::SimulateInput)?;
        let portal = RemoteDesktop::new().await.map_err(failed)?;
        let session = portal.create_session(CreateSessionOptions::default()).await.map_err(failed)?;
        let clipboard = Arc::new(Clipboard::new().await.map_err(failed)?);
        clipboard.request(&session, RequestClipboardOptions::default()).await.map_err(failed)?;

        let token = read_token();
        portal
            .select_devices(
                &session,
                SelectDevicesOptions::default()
                    .set_devices(BitFlags::from(DeviceType::Keyboard))
                    .set_persist_mode(PersistMode::ExplicitlyRevoked)
                    .set_restore_token(token.as_deref()),
            )
            .await
            .and_then(|request| request.response())
            .map_err(failed)?;
        let started = portal
            .start(&session, None, StartOptions::default())
            .await
            .and_then(|request| request.response());
        let selected = match started {
            Ok(selected) => selected,
            Err(ashpd::Error::Response(ResponseError::Cancelled)) => return Err(ClipboardError::Refused),
            Err(e) => return Err(failed(e)),
        };
        if let Some(token) = selected.restore_token() {
            save_token(token);
        }
        if !selected.devices().contains(DeviceType::Keyboard) {
            return Err(ClipboardError::Refused);
        }

        let remote = Self {
            portal,
            clipboard,
            session,
            clipboard_enabled: selected.is_clipboard_enabled(),
            offered: Arc::default(),
            owned: Arc::default(),
            fetched: Arc::default(),
        };
        remote.serve().await?;
        Ok(remote)
    }

    /// Hand the offered text to every window that fetches it, and follow who owns
    /// the clipboard.
    ///
    /// The signals are listened to from a task holding its own handle on the
    /// portal, and this returns once they are, so no fetch comes before.
    async fn serve(&self) -> Result<(), ClipboardError> {
        let (clipboard, offered, owned, fetched) =
            (self.clipboard.clone(), self.offered.clone(), self.owned.clone(), self.fetched.clone());
        let (ready, listening) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let streams = futures::future::try_join(
                clipboard.receive_selection_transfer::<RemoteDesktop>(),
                clipboard.receive_selection_owner_changed::<RemoteDesktop>(),
            )
            .await;
            let (transfers, owners) = match streams {
                Ok(streams) => streams,
                Err(e) => {
                    let _ = ready.send(Err(failed(e)));
                    return;
                }
            };
            let _ = ready.send(Ok(()));
            let (mut transfers, mut owners) = (Box::pin(transfers), Box::pin(owners));
            loop {
                tokio::select! {
                    Some((session, _, serial)) = transfers.next() => {
                        let content = offered.lock().clone();
                        let written = match clipboard.selection_write(&session, serial).await {
                            Ok(fd) => std::fs::File::from(std::os::fd::OwnedFd::from(fd)).write_all(&content).is_ok(),
                            Err(_) => false,
                        };
                        let _ = clipboard.selection_write_done(&session, serial, written).await;
                        fetched.fetch_add(1, Ordering::SeqCst);
                    }
                    Some((_, change)) = owners.next() => {
                        owned.store(change.session_is_owner() == Some(true), Ordering::SeqCst);
                    }
                    else => break,
                }
            }
        });
        listening.await.unwrap_or_else(|_| Err(ClipboardError::SimulateInput("the clipboard listener stopped".into())))
    }

    /// Offer the text, press Ctrl+V, and offer what the clipboard held before
    /// once the window has fetched it.
    async fn paste(&self, text: Vec<u8>, preserve_clipboard: bool) -> Result<(), ClipboardError> {
        let previous = if preserve_clipboard { self.held_text().await } else { None };
        let fetched = self.fetched.load(Ordering::SeqCst);
        self.offer(text).await?;
        self.chord(&[KEYSYM_CONTROL], KEYSYM_V).await?;

        // The window fetches the text as it reads the paste. Offering the old text
        // before that would paste the old text.
        for _ in 0..50 {
            if self.fetched.load(Ordering::SeqCst) > fetched {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Some(previous) = previous {
            self.offer(previous).await?;
        }
        Ok(())
    }

    /// The text the clipboard holds now, when it holds some. Anything else it
    /// holds is not carried over.
    async fn held_text(&self) -> Option<Vec<u8>> {
        if self.owned.load(Ordering::SeqCst) {
            return Some(self.offered.lock().clone());
        }
        let fd = self.clipboard.selection_read(&self.session, TEXT_TYPES[0]).await.ok()?;
        let reading = tokio::task::spawn_blocking(move || {
            let mut content = Vec::new();
            std::fs::File::from(std::os::fd::OwnedFd::from(fd)).read_to_end(&mut content).map(|_| content)
        });
        match tokio::time::timeout(Duration::from_millis(300), reading).await {
            Ok(Ok(Ok(content))) if !content.is_empty() => Some(content),
            _ => None,
        }
    }

    async fn offer(&self, content: Vec<u8>) -> Result<(), ClipboardError> {
        *self.offered.lock() = content;
        self.clipboard
            .set_selection(&self.session, SetSelectionOptions::default().set_mime_types(&TEXT_TYPES))
            .await
            .map_err(failed)?;
        self.owned.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Type the text key by key, for a session without the clipboard.
    async fn type_keysyms(&self, text: &str) -> Result<(), ClipboardError> {
        for character in text.chars() {
            self.chord(&[], keysym_of_char(character)).await?;
        }
        Ok(())
    }

    /// Press the modifiers, click the key, and let the modifiers go in reverse.
    async fn chord(&self, held: &[i32], key: i32) -> Result<(), ClipboardError> {
        for &modifier in held {
            self.key(modifier, KeyState::Pressed).await?;
        }
        self.key(key, KeyState::Pressed).await?;
        self.key(key, KeyState::Released).await?;
        for &modifier in held.iter().rev() {
            self.key(modifier, KeyState::Released).await?;
        }
        Ok(())
    }

    async fn key(&self, keysym: i32, state: KeyState) -> Result<(), ClipboardError> {
        self.portal
            .notify_keyboard_keysym(&self.session, keysym, state, NotifyKeyboardKeysymOptions::default())
            .await
            .map_err(failed)
    }
}

fn failed(error: ashpd::Error) -> ClipboardError {
    ClipboardError::SimulateInput(error.to_string())
}

/// The keysym of a character: Latin-1 is its own code point, the rest is the
/// code point offset by `0x01000000`.
fn keysym_of_char(character: char) -> i32 {
    match character {
        '\n' => 0xff0d,
        '\t' => 0xff09,
        ' '..='~' | '\u{a0}'..='\u{ff}' => character as i32,
        other => 0x0100_0000 | other as i32,
    }
}

/// The keysym of a key named in a companion shortcut.
fn keysym_of_key(name: &str) -> Option<i32> {
    let keysym = match name {
        "space" => 0x20,
        "enter" | "return" => 0xff0d,
        "tab" => 0xff09,
        "escape" | "esc" => 0xff1b,
        "backspace" => 0xff08,
        "delete" | "del" => 0xffff,
        "up" => 0xff52,
        "down" => 0xff54,
        "left" => 0xff51,
        "right" => 0xff53,
        function if function.starts_with('f') && function.len() > 1 => {
            let number: i32 = function[1..].parse().ok().filter(|n| (1..=12).contains(n))?;
            0xffbe + number - 1
        }
        single => {
            let mut characters = single.chars();
            let character = characters.next()?;
            if characters.next().is_some() {
                return None;
            }
            keysym_of_char(character)
        }
    };
    Some(keysym)
}

/// Where the desktop's restore token is kept between launches.
fn token_path() -> Option<std::path::PathBuf> {
    crate::paths::config_dir().map(|dir| dir.join("portal-restore-token"))
}

fn read_token() -> Option<String> {
    let token = std::fs::read_to_string(token_path()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

fn save_token(token: &str) {
    let Some(path) = token_path() else { return };
    if let Err(e) = crate::atomic_file::write(&path, token.as_bytes()) {
        eprintln!("Failed to keep the desktop's restore token: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn characters_map_to_their_keysyms() {
        assert_eq!(keysym_of_char('a'), 0x61);
        assert_eq!(keysym_of_char('é'), 0xe9);
        assert_eq!(keysym_of_char('œ'), 0x0100_0153);
        assert_eq!(keysym_of_char('\n'), 0xff0d);
    }

    #[test]
    fn companion_keys_map_to_their_keysyms() {
        assert_eq!(keysym_of_key("f5"), Some(0xffc2));
        assert_eq!(keysym_of_key("m"), Some(0x6d));
        assert_eq!(keysym_of_key("f13"), None);
        assert_eq!(keysym_of_key("nope"), None);
    }
}
