//! Optional Google sign-in, and what it syncs through the user's own Drive.

#![allow(dead_code)]

mod auth;
mod drive;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    /// False in a build made without Google credentials.
    pub available: bool,
    pub email: Option<String>,
}

fn status() -> GoogleStatus {
    GoogleStatus {
        available: auth::available(),
        email: auth::signed_in_email(),
    }
}

#[tauri::command]
pub fn google_status() -> GoogleStatus {
    status()
}

#[tauri::command]
pub async fn google_sign_in(app: tauri::AppHandle) -> Result<GoogleStatus, String> {
    auth::sign_in(&app).await?;
    Ok(status())
}

#[tauri::command]
pub fn google_sign_out(db: tauri::State<'_, crate::database::Database>) -> Result<GoogleStatus, String> {
    auth::sign_out();
    db.clear_remote_stats().map_err(|e| e.to_string())?;
    Ok(status())
}
