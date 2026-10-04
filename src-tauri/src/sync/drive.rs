//! The few Drive calls sync needs, all inside the app data folder.

use super::failure::SyncError;
use serde::Deserialize;
use std::time::Duration;

const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub modified_time: String,
    /// Bytes, as Drive writes them: a string. Absent for a file that is not blob content.
    #[serde(default)]
    pub size: Option<String>,
}

impl DriveFile {
    /// Drive itself says the file holds nothing: what a create that never got
    /// its content leaves behind. Judged on the listing and never on a body.
    pub fn is_empty_on_drive(&self) -> bool {
        self.size.as_deref().and_then(|size| size.parse::<u64>().ok()) == Some(0)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
}

pub struct Drive {
    http: reqwest::Client,
    token: parking_lot::Mutex<String>,
}

async fn check(response: reqwest::Response) -> Result<reqwest::Response, SyncError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(SyncError::from_response(status, &body))
}

const MAX_ERROR_CHARS: usize = 300;

/// A short sentence for a failed Google call: the message of its JSON error
/// body when it has one, the status line otherwise.
pub fn describe_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|json| {
            // Drive nests {"error": {"message": ...}}; the token endpoint
            // answers {"error": "invalid_grant", "error_description": ...}.
            let error = json.get("error")?;
            error
                .get("message")
                .or_else(|| json.get("error_description"))
                .or(Some(error))?
                .as_str()
                .map(|m| m.split_whitespace().collect::<Vec<_>>().join(" "))
        })
        .filter(|m| !m.is_empty());
    let text = message.unwrap_or_else(|| format!("Google answered {}", status));
    if text.chars().count() <= MAX_ERROR_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_ERROR_CHARS - 3).collect();
    format!("{}...", cut.trim_end())
}

impl Drive {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { http, token: parking_lot::Mutex::new(token) }
    }

    /// Send what `build` draws with the current token. A 401 may only mean the
    /// token ran out or was revoked since it was cached, so the cache is dropped,
    /// a new token is asked for, and the request goes once more.
    async fn send(
        &self,
        build: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, SyncError> {
        let token = self.token.lock().clone();
        let response = retry_once_when_unauthorized(
            token,
            |token| {
                let request = build(&self.http).bearer_auth(token);
                async move { request.send().await.map_err(SyncError::from) }
            },
            || async {
                super::auth::forget_access_token();
                let fresh = super::auth::access_token().await?;
                *self.token.lock() = fresh.clone();
                Ok(fresh)
            },
            |response: &reqwest::Response| response.status() == reqwest::StatusCode::UNAUTHORIZED,
        )
        .await?;
        check(response).await
    }

    /// Every file in the app data folder, newest first so that a duplicated
    /// name resolves to the last one written.
    pub async fn list(&self) -> Result<Vec<DriveFile>, SyncError> {
        let mut all = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let response = self
                .send(|http| {
                    let request = http.get(FILES_URL).query(&[
                        ("spaces", "appDataFolder"),
                        ("fields", "nextPageToken,files(id,name,modifiedTime,size)"),
                        ("orderBy", "modifiedTime desc"),
                        ("pageSize", "100"),
                    ]);
                    match &page {
                        Some(token) => request.query(&[("pageToken", token.as_str())]),
                        None => request,
                    }
                })
                .await?;
            let list: FileList = response.json().await?;
            all.extend(list.files);
            match list.next_page_token {
                Some(next) => page = Some(next),
                None => return Ok(all),
            }
        }
    }

    pub async fn download(&self, id: &str) -> Result<String, SyncError> {
        let response = self
            .send(|http| http.get(format!("{}/{}", FILES_URL, id)).query(&[("alt", "media")]))
            .await?;
        Ok(response.text().await?)
    }

    /// Write `content` under `name`, replacing the file `existing` points at
    /// or creating one when there is none.
    ///
    /// A new file goes up in one request, metadata and content together, so
    /// that a failure part way never leaves an empty file behind for the other
    /// machines to read.
    pub async fn upload(&self, name: &str, existing: Option<&str>, content: String) -> Result<(), SyncError> {
        self.send(|http| upload_request(http, name, existing, &content)).await?;
        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<(), SyncError> {
        self.send(|http| http.delete(format!("{}/{}", FILES_URL, id))).await?;
        Ok(())
    }
}

/// Send with `token`; when the answer says the token is no good, ask `renew` for
/// another once and send again. A second refusal is the answer, whatever it is.
async fn retry_once_when_unauthorized<R, E, SendFut, RenewFut>(
    token: String,
    mut send: impl FnMut(String) -> SendFut,
    renew: impl FnOnce() -> RenewFut,
    unauthorized: impl Fn(&R) -> bool,
) -> Result<R, E>
where
    SendFut: std::future::Future<Output = Result<R, E>>,
    RenewFut: std::future::Future<Output = Result<String, E>>,
{
    let first = send(token).await?;
    if !unauthorized(&first) {
        return Ok(first);
    }
    let fresh = renew().await?;
    send(fresh).await
}

/// The request that writes `content`: a media PATCH over an existing file, a
/// multipart POST for a new one.
fn upload_request(
    http: &reqwest::Client,
    name: &str,
    existing: Option<&str>,
    content: &str,
) -> reqwest::RequestBuilder {
    match existing {
        Some(id) => http
            .patch(format!("{}/{}", UPLOAD_URL, id))
            .query(&[("uploadType", "media")])
            .header("Content-Type", "application/json")
            .body(content.to_string()),
        None => {
            let boundary = multipart_boundary(&[name, content]);
            http.post(UPLOAD_URL)
                .query(&[("uploadType", "multipart"), ("fields", "id")])
                .header("Content-Type", format!("multipart/related; boundary={}", boundary))
                .body(multipart_body(&boundary, name, content))
        }
    }
}

/// A boundary that appears in none of `texts`, so no content can end a part early.
fn multipart_boundary(texts: &[&str]) -> String {
    boundary_avoiding(|| format!("talk-{:032x}", rand::random::<u128>()), texts)
}

fn boundary_avoiding(mut next: impl FnMut() -> String, texts: &[&str]) -> String {
    loop {
        let boundary = next();
        if texts.iter().all(|text| !text.contains(&boundary)) {
            return boundary;
        }
    }
}

/// The body of a Drive multipart upload: the metadata of a new file in the app
/// data folder, then its content.
fn multipart_body(boundary: &str, name: &str, content: &str) -> String {
    let metadata = serde_json::json!({ "name": name, "parents": ["appDataFolder"] });
    format!(
        "--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
         --{b}\r\nContent-Type: application/json\r\n\r\n{content}\r\n--{b}--",
        b = boundary
    )
}

/// The first file called `name`, which with the newest-first listing is the
/// most recent one.
pub fn find<'a>(files: &'a [DriveFile], name: &str) -> Option<&'a DriveFile> {
    files.iter().find(|f| f.name == name)
}

/// The file the account's copy of `name` is read from. Two files of one name can
/// exist, left by the old two-step create that could be interrupted between its
/// requests, so the newest one that holds something wins; only when every file of
/// that name is empty is the newest of them taken, to be filled in over.
pub fn find_with_content<'a>(files: &'a [DriveFile], name: &str) -> Option<&'a DriveFile> {
    files
        .iter()
        .find(|f| f.name == name && !f.is_empty_on_drive())
        .or_else(|| find(files, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, name: &str) -> DriveFile {
        DriveFile { id: id.to_string(), name: name.to_string(), modified_time: String::new(), size: None }
    }

    /// Answers `statuses` in turn and counts the sends and the renewals.
    async fn run(statuses: Vec<u16>) -> (Result<u16, String>, Vec<String>, usize) {
        let sent = std::cell::RefCell::new(Vec::new());
        let renewed = std::cell::Cell::new(0);
        let mut answers = statuses.into_iter();
        let result = retry_once_when_unauthorized(
            "old".to_string(),
            |token| {
                sent.borrow_mut().push(token);
                let status = answers.next().expect("no more than two sends");
                async move { Ok::<u16, String>(status) }
            },
            || async {
                renewed.set(renewed.get() + 1);
                Ok("new".to_string())
            },
            |status: &u16| *status == 401,
        )
        .await;
        (result, sent.into_inner(), renewed.get())
    }

    #[tokio::test]
    async fn a_401_renews_the_token_once_and_sends_once_more_with_it() {
        let (result, sent, renewed) = run(vec![401, 200]).await;
        assert_eq!(result, Ok(200));
        assert_eq!(sent, ["old", "new"]);
        assert_eq!(renewed, 1);
    }

    #[tokio::test]
    async fn a_second_401_is_the_answer_and_nothing_is_tried_a_third_time() {
        let (result, sent, renewed) = run(vec![401, 401]).await;
        assert_eq!(result, Ok(401));
        assert_eq!(sent.len(), 2);
        assert_eq!(renewed, 1);
    }

    #[tokio::test]
    async fn an_answer_that_is_not_a_401_is_not_retried() {
        let (result, sent, renewed) = run(vec![403]).await;
        assert_eq!(result, Ok(403));
        assert_eq!(sent, ["old"]);
        assert_eq!(renewed, 0);
    }

    #[test]
    fn the_newest_file_with_content_is_read_and_an_empty_one_is_filled_only_when_alone() {
        let sized = |id: &str, size: &str| DriveFile { size: Some(size.to_string()), ..file(id, "settings.json") };
        let files = vec![sized("empty-new", "0"), sized("old", "120"), file("other", "devices.json")];
        assert_eq!(find_with_content(&files, "settings.json").map(|f| f.id.as_str()), Some("old"));

        let only_empty = vec![sized("empty-new", "0"), sized("empty-old", "0")];
        assert_eq!(find_with_content(&only_empty, "settings.json").map(|f| f.id.as_str()), Some("empty-new"));
        assert!(find_with_content(&only_empty, "devices.json").is_none());
    }

    #[test]
    fn only_a_listed_size_of_zero_is_an_empty_file() {
        let sized = |size: Option<&str>| DriveFile { size: size.map(str::to_string), ..file("a", "settings.json") };
        assert!(sized(Some("0")).is_empty_on_drive());
        assert!(!sized(Some("2")).is_empty_on_drive());
        assert!(!sized(Some("garbage")).is_empty_on_drive());
        assert!(!sized(None).is_empty_on_drive());
        let listed: FileList = serde_json::from_str(r#"{"files": [{"id": "1", "name": "n", "size": "0"}]}"#).unwrap();
        assert!(listed.files[0].is_empty_on_drive());
    }

    #[test]
    fn a_duplicated_name_resolves_to_the_first_listed() {
        let files = vec![file("new", "settings.json"), file("old", "settings.json")];
        assert_eq!(find(&files, "settings.json").map(|f| f.id.as_str()), Some("new"));
        assert!(find(&files, "stats-x.json").is_none());
    }

    fn built(name: &str, existing: Option<&str>, content: &str) -> reqwest::Request {
        upload_request(&reqwest::Client::new(), name, existing, content).build().unwrap()
    }

    fn body_of(request: &reqwest::Request) -> String {
        String::from_utf8(request.body().and_then(|b| b.as_bytes()).unwrap().to_vec()).unwrap()
    }

    #[test]
    fn a_new_file_is_one_multipart_post_to_the_upload_endpoint() {
        let content = r#"{"a":"é"}"#;
        let request = built("settings.json", None, content);

        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().path(), "/upload/drive/v3/files");
        let query: Vec<(String, String)> =
            request.url().query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert!(query.contains(&("uploadType".to_string(), "multipart".to_string())));

        let header = request.headers()["content-type"].to_str().unwrap().to_string();
        let boundary = header.strip_prefix("multipart/related; boundary=").expect("a related multipart");

        let body = body_of(&request);
        assert!(body.starts_with(&format!("--{}\r\n", boundary)));
        assert!(body.ends_with(&format!("\r\n--{}--", boundary)));
        let delimiter = format!("--{}", boundary);
        let parts: Vec<&str> = body.split(&delimiter).collect();
        assert_eq!(parts.len(), 4, "an opening, two parts and the closing");
        assert_eq!(parts[3], "--");

        let (metadata_head, metadata) = parts[1].split_once("\r\n\r\n").unwrap();
        assert_eq!(metadata_head, "\r\nContent-Type: application/json; charset=UTF-8");
        let metadata: serde_json::Value = serde_json::from_str(metadata.trim_end()).unwrap();
        assert_eq!(metadata["name"], "settings.json");
        assert_eq!(metadata["parents"][0], "appDataFolder");

        let (content_head, sent) = parts[2].split_once("\r\n\r\n").unwrap();
        assert_eq!(content_head, "\r\nContent-Type: application/json");
        assert_eq!(sent, format!("{}\r\n", content));
    }

    #[test]
    fn an_existing_file_is_a_media_patch_of_its_id() {
        let request = built("settings.json", Some("abc"), "{}");

        assert_eq!(request.method(), reqwest::Method::PATCH);
        assert_eq!(request.url().path(), "/upload/drive/v3/files/abc");
        assert_eq!(request.url().query(), Some("uploadType=media"));
        assert_eq!(body_of(&request), "{}");
    }

    #[test]
    fn a_boundary_found_in_the_content_is_never_used() {
        let mut offered = vec!["clash".to_string(), "free".to_string()].into_iter();
        let boundary = boundary_avoiding(|| offered.next().unwrap(), &["a", "content with clash in it"]);
        assert_eq!(boundary, "free");
        let body = multipart_body(&boundary, "n", "content with clash in it");
        assert_eq!(body.matches("--free").count(), 3);
    }

    #[test]
    fn two_boundaries_differ() {
        assert_ne!(multipart_boundary(&[]), multipart_boundary(&[]));
    }

    fn status(code: u16) -> reqwest::StatusCode {
        reqwest::StatusCode::from_u16(code).unwrap()
    }

    #[test]
    fn a_google_error_body_is_reduced_to_its_message() {
        let body = r#"{
  "error": {
    "code": 403,
    "message": "Google Drive API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=123 then retry.",
    "errors": [{"reason": "accessNotConfigured"}],
    "status": "PERMISSION_DENIED"
  }
}"#;
        let text = describe_error(status(403), body);
        assert!(text.starts_with("Google Drive API has not been used in project 123"));
        assert!(text.ends_with("then retry."));
        assert!(!text.contains('{') && !text.contains('\n'));
    }

    #[test]
    fn the_token_endpoint_error_is_reduced_to_its_description() {
        let body = r#"{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}"#;
        assert_eq!(describe_error(status(400), body), "Token has been expired or revoked.");
    }

    #[test]
    fn a_body_that_is_not_json_falls_back_to_the_status_line() {
        assert_eq!(
            describe_error(status(502), "<html>Bad gateway</html>"),
            "Google answered 502 Bad Gateway"
        );
        assert_eq!(describe_error(status(403), ""), "Google answered 403 Forbidden");
    }

    #[test]
    fn a_long_message_is_capped() {
        let body = format!(r#"{{"error": {{"message": "{}"}}}}"#, "x".repeat(900));
        let text = describe_error(status(500), &body);
        assert_eq!(text.chars().count(), 300);
        assert!(text.ends_with("..."));
    }
}
