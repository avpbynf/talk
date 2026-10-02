//! The few Drive calls sync needs, all inside the app data folder.

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
    token: String,
}

async fn check(response: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!("Drive answered {}: {}", status, body))
}

impl Drive {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { http, token }
    }

    /// Every file in the app data folder, newest first so that a duplicated
    /// name resolves to the last one written.
    pub async fn list(&self) -> Result<Vec<DriveFile>, String> {
        let mut all = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut request = self
                .http
                .get(FILES_URL)
                .bearer_auth(&self.token)
                .query(&[
                    ("spaces", "appDataFolder"),
                    ("fields", "nextPageToken,files(id,name,modifiedTime)"),
                    ("orderBy", "modifiedTime desc"),
                    ("pageSize", "100"),
                ]);
            if let Some(token) = &page {
                request = request.query(&[("pageToken", token.as_str())]);
            }
            let response = check(request.send().await.map_err(|e| e.to_string())?).await?;
            let list: FileList = response.json().await.map_err(|e| e.to_string())?;
            all.extend(list.files);
            match list.next_page_token {
                Some(next) => page = Some(next),
                None => return Ok(all),
            }
        }
    }

    pub async fn download(&self, id: &str) -> Result<String, String> {
        let response = self
            .http
            .get(format!("{}/{}", FILES_URL, id))
            .bearer_auth(&self.token)
            .query(&[("alt", "media")])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        check(response).await?.text().await.map_err(|e| e.to_string())
    }

    /// Write `content` under `name`, replacing the file `existing` points at
    /// or creating one when there is none.
    pub async fn upload(&self, name: &str, existing: Option<&str>, content: String) -> Result<(), String> {
        let id = match existing {
            Some(id) => id.to_string(),
            None => {
                let response = self
                    .http
                    .post(FILES_URL)
                    .bearer_auth(&self.token)
                    .query(&[("fields", "id")])
                    .json(&serde_json::json!({ "name": name, "parents": ["appDataFolder"] }))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let created: serde_json::Value = check(response).await?.json().await.map_err(|e| e.to_string())?;
                created["id"].as_str().ok_or("Drive returned no file id")?.to_string()
            }
        };

        let response = self
            .http
            .patch(format!("{}/{}", UPLOAD_URL, id))
            .bearer_auth(&self.token)
            .query(&[("uploadType", "media")])
            .header("Content-Type", "application/json")
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        check(response).await?;
        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<(), String> {
        let response = self
            .http
            .delete(format!("{}/{}", FILES_URL, id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        check(response).await?;
        Ok(())
    }
}

/// The first file called `name`, which with the newest-first listing is the
/// most recent one.
pub fn find<'a>(files: &'a [DriveFile], name: &str) -> Option<&'a DriveFile> {
    files.iter().find(|f| f.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, name: &str) -> DriveFile {
        DriveFile { id: id.to_string(), name: name.to_string(), modified_time: String::new() }
    }

    #[test]
    fn a_duplicated_name_resolves_to_the_first_listed() {
        let files = vec![file("new", "settings.json"), file("old", "settings.json")];
        assert_eq!(find(&files, "settings.json").map(|f| f.id.as_str()), Some("new"));
        assert!(find(&files, "stats-x.json").is_none());
    }
}
