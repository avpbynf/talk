//! Why a sync or a sign-in failed, as one of a few codes the Account page words in
//! the interface language. The raw text travels beside the code, so that the page
//! can show it under the wording: a release build has no console to read it in.

use super::drive::describe_error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// No connection, or Google did not answer in time.
    Offline,
    /// The refresh token was revoked or has expired: only a new sign-in helps.
    GrantRevoked,
    /// The Drive API is not enabled for the app, or access to it is forbidden.
    ApiDisabled,
    /// Google is limiting requests.
    Quota,
    /// The account has no room left on its Drive.
    DriveFull,
    /// A file of the account is not readable here: written by a newer version,
    /// or cut short. Nothing is uploaded over it.
    RemoteUnreadable,
    /// The same, for the list of devices.
    RemoteDevicesUnreadable,
    /// This computer's database failed.
    Database,
    SignInTimeout,
    /// Google reported that the consent was refused.
    SignInRefused,
    /// Google would not turn the consent into tokens.
    SignInFailed,
    /// The token response did not say which account signed in.
    SignInNoEmail,
    /// The consent was given without the access to Drive.
    SignInNoDrive,
    Other,
}

impl Failure {
    /// What the page receives and looks up in its translations.
    pub fn code(self) -> &'static str {
        match self {
            Failure::Offline => "offline",
            Failure::GrantRevoked => "grant_revoked",
            Failure::ApiDisabled => "api_disabled",
            Failure::Quota => "quota",
            Failure::DriveFull => "drive_full",
            Failure::RemoteUnreadable => "remote_unreadable",
            Failure::RemoteDevicesUnreadable => "remote_devices_unreadable",
            Failure::Database => "database",
            Failure::SignInTimeout => "sign_in_timeout",
            Failure::SignInRefused => "sign_in_refused",
            Failure::SignInFailed => "sign_in_failed",
            Failure::SignInNoEmail => "sign_in_no_email",
            Failure::SignInNoDrive => "sign_in_no_drive",
            Failure::Other => "other",
        }
    }
}

/// A failure with the text it came with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncError {
    pub failure: Failure,
    pub detail: String,
}

impl SyncError {
    pub fn other(detail: impl Into<String>) -> Self {
        Self { failure: Failure::Other, detail: detail.into() }
    }

    pub fn new(failure: Failure, detail: impl Into<String>) -> Self {
        Self { failure, detail: detail.into() }
    }

    pub fn database(error: impl std::fmt::Display) -> Self {
        Self::new(Failure::Database, error.to_string())
    }

    /// A Google answer that was not a success.
    pub fn from_response(status: reqwest::StatusCode, body: &str) -> Self {
        Self { failure: classify(status.as_u16(), body), detail: describe_error(status, body) }
    }

    /// What a command hands the page: the code, then Google's or the system's own text.
    pub fn encode(&self) -> String {
        format!("{}: {}", self.failure.code(), self.detail)
    }
}

impl From<String> for SyncError {
    fn from(detail: String) -> Self {
        Self::other(detail)
    }
}

impl From<&str> for SyncError {
    fn from(detail: &str) -> Self {
        Self::other(detail)
    }
}

impl From<reqwest::Error> for SyncError {
    fn from(error: reqwest::Error) -> Self {
        let failure = if error.is_connect() || error.is_timeout() { Failure::Offline } else { Failure::Other };
        Self { failure, detail: error.to_string() }
    }
}

/// The words Google puts in an error body to say what went wrong: the reasons of
/// a Drive error, its status, and the `error` of the token endpoint.
fn reasons(body: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else { return Vec::new() };
    let mut found = Vec::new();
    match json.get("error") {
        Some(serde_json::Value::String(code)) => found.push(code.clone()),
        Some(error) => {
            if let Some(status) = error.get("status").and_then(|v| v.as_str()) {
                found.push(status.to_string());
            }
            for list in ["errors", "details"] {
                for item in error.get(list).and_then(|v| v.as_array()).into_iter().flatten() {
                    if let Some(reason) = item.get("reason").and_then(|v| v.as_str()) {
                        found.push(reason.to_string());
                    }
                }
            }
        }
        None => {}
    }
    found.into_iter().map(|reason| reason.to_ascii_lowercase()).collect()
}

/// Sort a Google answer that was not a success.
pub fn classify(status: u16, body: &str) -> Failure {
    let reasons = reasons(body);
    let says = |wanted: &[&str]| reasons.iter().any(|reason| wanted.contains(&reason.as_str()));
    // Only the token endpoint says a grant is gone. A 401 from Drive may be a token
    // that ran out, which the caller renews once before it counts as anything.
    if says(&["invalid_grant"]) {
        return Failure::GrantRevoked;
    }
    if says(&["storagequotaexceeded"]) {
        return Failure::DriveFull;
    }
    if says(&["ratelimitexceeded", "userratelimitexceeded", "dailylimitexceeded", "quotaexceeded", "resource_exhausted"])
        || status == 429
    {
        return Failure::Quota;
    }
    if status == 403 || says(&["accessnotconfigured", "service_disabled"]) {
        return Failure::ApiDisabled;
    }
    Failure::Other
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_revoked_or_expired_grant_needs_a_new_sign_in() {
        let body = r#"{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}"#;
        assert_eq!(classify(400, body), Failure::GrantRevoked);
        assert_eq!(classify(401, body), Failure::GrantRevoked);
    }

    #[test]
    fn a_401_from_drive_and_the_other_token_errors_are_not_a_revoked_grant() {
        assert_eq!(classify(401, ""), Failure::Other);
        let expired = r#"{"error": {"code": 401, "status": "UNAUTHENTICATED", "message": "Invalid Credentials"}}"#;
        assert_eq!(classify(401, expired), Failure::Other);
        let client = r#"{"error": "invalid_client", "error_description": "Unauthorized"}"#;
        assert_eq!(classify(401, client), Failure::Other);
        assert_eq!(classify(400, r#"{"error": "invalid_request"}"#), Failure::Other);
    }

    #[test]
    fn a_full_drive_is_told_apart_from_a_rate_limit() {
        let full = r#"{"error": {"code": 403, "errors": [{"reason": "storageQuotaExceeded"}]}}"#;
        assert_eq!(classify(403, full), Failure::DriveFull);
    }

    #[test]
    fn a_drive_api_that_is_off_or_forbidden_is_told_apart_from_a_quota() {
        let off = r#"{"error": {"code": 403, "message": "Google Drive API has not been used", "errors": [{"reason": "accessNotConfigured"}], "status": "PERMISSION_DENIED"}}"#;
        assert_eq!(classify(403, off), Failure::ApiDisabled);
        let forbidden = r#"{"error": {"code": 403, "errors": [{"reason": "insufficientPermissions"}]}}"#;
        assert_eq!(classify(403, forbidden), Failure::ApiDisabled);
        assert_eq!(classify(403, ""), Failure::ApiDisabled);
        let modern = r#"{"error": {"code": 403, "details": [{"reason": "SERVICE_DISABLED"}]}}"#;
        assert_eq!(classify(403, modern), Failure::ApiDisabled);
    }

    #[test]
    fn rate_limits_and_quotas_are_one_failure_whatever_the_status() {
        let limited = r#"{"error": {"code": 403, "errors": [{"reason": "rateLimitExceeded"}]}}"#;
        assert_eq!(classify(403, limited), Failure::Quota);
        let user = r#"{"error": {"code": 403, "errors": [{"reason": "userRateLimitExceeded"}]}}"#;
        assert_eq!(classify(403, user), Failure::Quota);
        assert_eq!(classify(429, ""), Failure::Quota);
        assert_eq!(classify(429, r#"{"error": {"status": "RESOURCE_EXHAUSTED"}}"#), Failure::Quota);
    }

    #[test]
    fn anything_else_is_other() {
        assert_eq!(classify(500, ""), Failure::Other);
        assert_eq!(classify(502, "<html>Bad gateway</html>"), Failure::Other);
        assert_eq!(classify(404, r#"{"error": {"code": 404, "errors": [{"reason": "notFound"}]}}"#), Failure::Other);
    }

    #[test]
    fn a_response_keeps_its_text_for_the_log() {
        let error = SyncError::from_response(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"error": {"message": "Drive is off", "errors": [{"reason": "accessNotConfigured"}]}}"#,
        );
        assert_eq!(error.failure, Failure::ApiDisabled);
        assert_eq!(error.detail, "Drive is off");
        assert_eq!(error.failure.code(), "api_disabled");
    }

    #[tokio::test]
    async fn a_refused_connection_is_offline() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let error = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/", port))
            .send()
            .await
            .expect_err("nothing listens there");
        assert_eq!(SyncError::from(error).failure, Failure::Offline);
    }

    #[test]
    fn a_failure_is_handed_to_the_page_as_its_code_then_its_text() {
        let error = SyncError::new(Failure::SignInTimeout, "Sign-in timed out");
        assert_eq!(error.encode(), "sign_in_timeout: Sign-in timed out");
        assert_eq!(SyncError::database("locked").failure, Failure::Database);
    }

    #[test]
    fn a_plain_message_is_other() {
        assert_eq!(SyncError::from("Not signed in").failure, Failure::Other);
        assert_eq!(SyncError::from("x".to_string()).detail, "x");
    }

    #[test]
    fn every_code_is_distinct() {
        let codes = [
            Failure::Offline,
            Failure::GrantRevoked,
            Failure::ApiDisabled,
            Failure::Quota,
            Failure::DriveFull,
            Failure::RemoteUnreadable,
            Failure::RemoteDevicesUnreadable,
            Failure::Database,
            Failure::SignInTimeout,
            Failure::SignInRefused,
            Failure::SignInFailed,
            Failure::SignInNoEmail,
            Failure::SignInNoDrive,
            Failure::Other,
        ]
        .map(Failure::code);
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), codes.len());
    }
}
