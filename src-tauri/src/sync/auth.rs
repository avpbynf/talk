//! Google sign-in for an installed application: PKCE over a loopback redirect.
//!
//! The client id and secret are baked in at build time. A secret shipped in a
//! desktop binary is not a secret, and Google documents it that way for this
//! flow; the PKCE verifier is what actually protects the exchange.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::auth_page::{self, Page};

const CLIENT_ID: Option<&str> = option_env!("TALK_GOOGLE_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("TALK_GOOGLE_CLIENT_SECRET");

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/drive.appdata";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(180);

const KEYRING_SERVICE: &str = "Talk";
const KEYRING_USER: &str = "google-account";

/// What the Credential Manager holds for a signed-in account.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAccount {
    refresh_token: String,
    email: String,
}

struct CachedToken {
    value: String,
    expires: Instant,
}

static ACCESS_TOKEN: Mutex<Option<CachedToken>> = Mutex::new(None);

/// The way to wake a sign-in that is waiting for the browser. Empty when none is.
static CANCEL: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

/// Abandon the sign-in in progress, if there is one.
pub fn cancel_sign_in() {
    if let Some(cancel) = CANCEL.lock().take() {
        let _ = cancel.send(());
    }
}

/// Whether this build carries Google credentials at all.
pub fn available() -> bool {
    credentials().is_some()
}

fn credentials() -> Option<(&'static str, &'static str)> {
    match (CLIENT_ID, CLIENT_SECRET) {
        (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Some((id, secret)),
        _ => None,
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn stored_account() -> Option<StoredAccount> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

/// The signed-in email, or None when nobody is.
pub fn signed_in_email() -> Option<String> {
    stored_account().map(|a| a.email)
}

/// Forget the account on this machine. Drive files are left where they are.
pub fn sign_out() {
    if let Ok(entry) = entry() {
        let _ = entry.delete_credential();
    }
    *ACCESS_TOKEN.lock() = None;
}

fn random_url_safe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(client_id: &str, redirect: &str, state: &str, challenge: &str) -> String {
    let mut url = url::Url::parse(AUTH_URL).expect("constant URL");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.into()
}

/// What the browser handed back on the loopback address.
#[derive(Debug, PartialEq)]
enum Redirect {
    Code { code: String, state: String },
    Denied { error: String, state: Option<String> },
    /// A request that is not the redirect, a favicon for instance.
    Other,
}

fn parse_redirect(request: &str) -> Redirect {
    let Some(line) = request.lines().next() else {
        return Redirect::Other;
    };
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Redirect::Other;
    };
    let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{}", target)) else {
        return Redirect::Other;
    };

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }

    match (code, state, error) {
        (_, state, Some(error)) => Redirect::Denied { error, state },
        (Some(code), Some(state), None) => Redirect::Code { code, state },
        _ => Redirect::Other,
    }
}

fn response_bytes(status: &str, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    )
    .into_bytes()
}

/// How the wait for the browser ended, short of an error.
#[derive(Debug, PartialEq)]
enum Wait {
    Code(String),
    Cancelled,
}

/// Wait for the browser to come back with the code. A request carrying some
/// other state is answered with an error page and ignored, so something else
/// on the machine poking the port cannot end the wait.
async fn wait_for_redirect(
    listener: TcpListener,
    expected_state: &str,
    mut cancel: oneshot::Receiver<()>,
) -> Result<Wait, String> {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let accepted = tokio::select! {
            accepted = tokio::time::timeout(remaining, listener.accept()) => accepted,
            _ = &mut cancel => return Ok(Wait::Cancelled),
        };
        let (mut stream, _) = accepted
            .map_err(|_| "Sign-in timed out".to_string())?
            .map_err(|e| e.to_string())?;

        let mut buf = vec![0u8; 8192];
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf))
            .await
            .unwrap_or(Ok(0))
            .unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..read]).to_string();
        let parsed = parse_redirect(&request);

        let wrong_state = match &parsed {
            Redirect::Code { state, .. } => state != expected_state,
            Redirect::Denied { state, .. } => state.as_deref() != Some(expected_state),
            Redirect::Other => false,
        };
        let french = auth_page::prefers_french(&request);
        let (status, body) = match &parsed {
            Redirect::Other => ("404 Not Found", String::new()),
            _ if wrong_state => ("400 Bad Request", auth_page::render(Page::Unexpected, french)),
            Redirect::Denied { .. } => ("200 OK", auth_page::render(Page::Refused, french)),
            _ => ("200 OK", auth_page::render(Page::Done, french)),
        };
        let _ = stream.write_all(&response_bytes(status, &body)).await;
        let _ = stream.shutdown().await;

        match parsed {
            Redirect::Code { code, .. } if !wrong_state => return Ok(Wait::Code(code)),
            Redirect::Denied { error, .. } if !wrong_state => {
                return Err(format!("Google refused the sign-in: {}", error))
            }
            _ => continue,
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

async fn token_request(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(form)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        // invalid_grant is what a revoked or expired refresh token answers.
        return Err(format!("Google answered {}: {}", status, body));
    }
    response.json().await.map_err(|e| e.to_string())
}

/// The email claim of an id token received straight from Google over TLS.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email")?.as_str().map(str::to_string)
}

/// A completed sign-in that has not been kept yet.
pub struct PendingSignIn {
    account: StoredAccount,
    token: CachedToken,
}

/// Run the browser round trip and the code exchange. Nothing is stored until
/// `store` is called, so the caller can get its own state in order first.
/// None means the user cancelled while the browser was open.
pub async fn authorize(app: &tauri::AppHandle) -> Result<Option<PendingSignIn>, String> {
    let (client_id, client_secret) = credentials().ok_or("Sign-in is not available in this build")?;

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{}", port);

    let verifier = random_url_safe(32);
    let state = random_url_safe(16);
    let url = authorization_url(client_id, &redirect, &state, &challenge_for(&verifier));

    let (cancel_tx, cancel_rx) = oneshot::channel();
    *CANCEL.lock() = Some(cancel_tx);

    let waited = match app.opener().open_url(url, None::<&str>) {
        Ok(()) => wait_for_redirect(listener, &state, cancel_rx).await,
        Err(e) => Err(e.to_string()),
    };
    *CANCEL.lock() = None;
    let code = match waited? {
        Wait::Code(code) => code,
        Wait::Cancelled => return Ok(None),
    };
    bring_app_forward(app);

    let tokens = token_request(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", &code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect),
        ("grant_type", "authorization_code"),
    ])
    .await?;

    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or("Google did not return a refresh token")?;
    let email = tokens
        .id_token
        .as_deref()
        .and_then(email_from_id_token)
        .unwrap_or_default();

    Ok(Some(PendingSignIn {
        account: StoredAccount { refresh_token, email },
        token: CachedToken {
            value: tokens.access_token,
            expires: Instant::now() + Duration::from_secs(tokens.expires_in.saturating_sub(60)),
        },
    }))
}

/// Put Talk back in front once the browser has answered, whatever the browser
/// does with its own tab.
fn bring_app_forward(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Keep the account: the refresh token goes to the Credential Manager.
pub fn store(pending: PendingSignIn) -> Result<(), String> {
    entry()?
        .set_password(&serde_json::to_string(&pending.account).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    *ACCESS_TOKEN.lock() = Some(pending.token);
    Ok(())
}

/// A bearer token for Drive, renewed from the stored refresh token when the
/// last one has run out.
pub async fn access_token() -> Result<String, String> {
    if let Some(cached) = ACCESS_TOKEN.lock().as_ref() {
        if cached.expires > Instant::now() {
            return Ok(cached.value.clone());
        }
    }

    let (client_id, client_secret) = credentials().ok_or("Sign-in is not available in this build")?;
    let account = stored_account().ok_or("Not signed in")?;
    let tokens = token_request(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", &account.refresh_token),
        ("grant_type", "refresh_token"),
    ])
    .await?;

    *ACCESS_TOKEN.lock() = Some(CachedToken {
        value: tokens.access_token.clone(),
        expires: Instant::now() + Duration::from_secs(tokens.expires_in.saturating_sub(60)),
    });
    Ok(tokens.access_token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_the_sha256_of_the_verifier() {
        // The example from RFC 7636, appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(challenge_for(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn the_redirect_carries_the_code_and_the_state() {
        let request = "GET /?state=abc&code=4%2F0xyz&scope=email HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            parse_redirect(request),
            Redirect::Code { code: "4/0xyz".to_string(), state: "abc".to_string() }
        );
    }

    #[test]
    fn a_refusal_is_reported_and_a_favicon_is_ignored() {
        assert_eq!(
            parse_redirect("GET /?error=access_denied&state=abc HTTP/1.1\r\n\r\n"),
            Redirect::Denied { error: "access_denied".to_string(), state: Some("abc".to_string()) }
        );
        assert_eq!(parse_redirect("GET /favicon.ico HTTP/1.1\r\n\r\n"), Redirect::Other);
        assert_eq!(parse_redirect(""), Redirect::Other);
    }

    #[test]
    fn the_authorization_url_asks_for_the_drive_app_folder_only() {
        let url = authorization_url("id", "http://127.0.0.1:5000", "s", "c");
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("drive.appdata"));
        assert!(!url.contains("auth%2Fdrive%20") && !url.contains("auth%2Fdrive&"));
    }

    #[tokio::test]
    async fn a_cancel_ends_the_wait_and_frees_the_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let wait = tokio::spawn(async move { wait_for_redirect(listener, "state", cancel_rx).await });

        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_tx.send(()).unwrap();

        let outcome = tokio::time::timeout(Duration::from_secs(2), wait).await.unwrap().unwrap();
        assert_eq!(outcome, Ok(Wait::Cancelled));
        TcpListener::bind(("127.0.0.1", port)).await.expect("the port is free again");
    }

    #[test]
    fn cancelling_with_nothing_pending_does_nothing() {
        cancel_sign_in();
        assert!(CANCEL.lock().is_none());
    }

    #[test]
    fn the_content_length_is_the_byte_length_of_an_accented_body() {
        let body = auth_page::render(Page::Done, true);
        assert!(body.len() > body.chars().count());
        let response = String::from_utf8(response_bytes("200 OK", &body)).unwrap();
        let (head, sent) = response.split_once("\r\n\r\n").unwrap();
        assert!(head.contains(&format!("Content-Length: {}", body.len())));
        assert_eq!(sent.len(), body.len());
    }

    #[test]
    fn the_email_is_read_from_the_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"me@example.com","sub":"1"}"#);
        let token = format!("header.{}.signature", payload);
        assert_eq!(email_from_id_token(&token).as_deref(), Some("me@example.com"));
        assert_eq!(email_from_id_token("garbage"), None);
    }
}
