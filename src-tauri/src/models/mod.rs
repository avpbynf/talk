use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ModelError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Model not found: {0}")]
    NotFound(String),
    #[error("Invalid model ID: {0}")]
    InvalidModelId(String),
    #[error("Download cancelled")]
    Cancelled,
}

fn sanitize_model_id(model_id: &str) -> Result<&str, ModelError> {
    if model_id.len() > 100 {
        return Err(ModelError::InvalidModelId(
            "model ID exceeds 100 characters".to_string(),
        ));
    }

    if model_id.contains("..") || model_id.contains('/') || model_id.contains('\\') {
        return Err(ModelError::InvalidModelId(
            "model ID contains forbidden path characters".to_string(),
        ));
    }

    if !model_id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(ModelError::InvalidModelId(
            "model ID contains invalid characters".to_string(),
        ));
    }

    Ok(model_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub size_mb: u64,
    pub description: String,
}

pub fn get_available_models() -> Vec<ModelInfo> {
    vec![
        // Tiny models
        ModelInfo {
            id: "tiny".to_string(),
            name: "Tiny".to_string(),
            size_mb: 78,
            description: "The fastest, and it shows".to_string(),
        },
        ModelInfo {
            id: "tiny-q5_1".to_string(),
            name: "Tiny Q5".to_string(),
            size_mb: 32,
            description: "Tiny, quantised. Barely there".to_string(),
        },
        // Base models
        ModelInfo {
            id: "base".to_string(),
            name: "Base".to_string(),
            size_mb: 148,
            description: "Fast, and good enough for most of it".to_string(),
        },
        ModelInfo {
            id: "base-q5_1".to_string(),
            name: "Base Q5".to_string(),
            size_mb: 60,
            description: "Base, quantised. Light".to_string(),
        },
        // Small models
        ModelInfo {
            id: "small".to_string(),
            name: "Small".to_string(),
            size_mb: 488,
            description: "An even trade of speed for accuracy".to_string(),
        },
        ModelInfo {
            id: "small-q5_1".to_string(),
            name: "Small Q5".to_string(),
            size_mb: 190,
            description: "Small, quantised".to_string(),
        },
        // Medium models
        ModelInfo {
            id: "medium".to_string(),
            name: "Medium".to_string(),
            size_mb: 1530,
            description: "Accurate, and slower for it".to_string(),
        },
        ModelInfo {
            id: "medium-q5_0".to_string(),
            name: "Medium Q5".to_string(),
            size_mb: 539,
            description: "Medium, quantised. A good middle".to_string(),
        },
        // Large v3 Turbo - great middle ground
        ModelInfo {
            id: "large-v3-turbo".to_string(),
            name: "Large v3 Turbo".to_string(),
            size_mb: 1620,
            description: "Large accuracy at Medium speed".to_string(),
        },
        ModelInfo {
            id: "large-v3-turbo-q5_0".to_string(),
            name: "Large v3 Turbo Q5".to_string(),
            size_mb: 574,
            description: "Turbo, quantised. The best accuracy per megabyte".to_string(),
        },
        // Large v3 full
        ModelInfo {
            id: "large-v3".to_string(),
            name: "Large v3".to_string(),
            size_mb: 3100,
            description: "The most accurate, and the slowest".to_string(),
        },
        ModelInfo {
            id: "large-v3-q5_0".to_string(),
            name: "Large v3 Q5".to_string(),
            size_mb: 1080,
            description: "Large, quantised".to_string(),
        },
    ]
}

pub struct ModelManager {
    models_dir: PathBuf,
    client: Client,
    /// Raised by the reader while a download runs, and read at every chunk.
    ///
    /// A model is around a gigabyte, so a download started by mistake on a slow
    /// line holds the page for a quarter of an hour. Nothing was watching for a
    /// change of mind.
    cancel_requested: AtomicBool,
}

impl ModelManager {
    pub fn new() -> Self {
        let models_dir = crate::paths::data_dir()
            .map(|dir| dir.join("models"))
            .unwrap_or_else(|| PathBuf::from("models"));

        std::fs::create_dir_all(&models_dir).ok();

        Self {
            models_dir,
            client: Client::new(),
            cancel_requested: AtomicBool::new(false),
        }
    }

    /// Ask the download in flight to stop at its next chunk.
    ///
    /// Nothing happens when none is running: the flag is cleared by the next
    /// download rather than left standing for it to walk into.
    pub fn cancel_download(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
    }

    pub fn get_models_dir(&self) -> &PathBuf {
        &self.models_dir
    }

    pub fn get_model_path(&self, model_id: &str) -> Option<PathBuf> {
        if sanitize_model_id(model_id).is_err() {
            return None;
        }
        let path = self.models_dir.join(format!("ggml-{}.bin", model_id));
        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    pub fn get_downloaded_models(&self) -> Vec<String> {
        let mut models = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&self.models_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with("ggml-") && name.ends_with(".bin") {
                        let model_id = name
                            .strip_prefix("ggml-")
                            .and_then(|s| s.strip_suffix(".bin"))
                            .unwrap_or(name);
                        models.push(model_id.to_string());
                    }
                }
            }
        }

        models
    }

    pub fn delete_model(&self, model_id: &str) -> Result<(), ModelError> {
        sanitize_model_id(model_id)?;
        let path = self.models_dir.join(format!("ggml-{}.bin", model_id));

        if !path.exists() {
            return Err(ModelError::NotFound(model_id.to_string()));
        }

        std::fs::remove_file(&path)?;
        Ok(())
    }

    pub async fn download_model(
        &self,
        model_id: &str,
        app: tauri::AppHandle,
    ) -> Result<PathBuf, ModelError> {
        sanitize_model_id(model_id)?;

        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
            model_id
        );

        let dest_path = self.models_dir.join(format!("ggml-{}.bin", model_id));
        let temp_path = self.models_dir.join(format!("ggml-{}.bin.tmp", model_id));

        // A cancellation raised before this one started belongs to a download
        // that is already over.
        self.cancel_requested.store(false, Ordering::SeqCst);

        // Start download
        let response = self.client.get(&url).send().await?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        let mut file = std::fs::File::create(&temp_path)?;
        let mut stream = response.bytes_stream();

        use std::io::Write;

        let download_result: Result<(), ModelError> = async {
            while let Some(chunk) = stream.next().await {
                if self.cancel_requested.swap(false, Ordering::SeqCst) {
                    return Err(ModelError::Cancelled);
                }

                let chunk = chunk?;
                file.write_all(&chunk)?;
                downloaded += chunk.len() as u64;

                // Emit progress
                let progress = if total_size > 0 {
                    (downloaded as f64 / total_size as f64 * 100.0) as u32
                } else {
                    0
                };

                app.emit(
                    "download-progress",
                    DownloadProgress {
                        model_id: model_id.to_string(),
                        progress,
                        downloaded_mb: downloaded / 1_000_000,
                        total_mb: total_size / 1_000_000,
                    },
                )
                .ok();
            }
            Ok(())
        }
        .await;

        if let Err(e) = download_result {
            // The partial file goes either way. Half a model on disk would be
            // counted as downloaded by its name alone and fail at load time.
            let _ = std::fs::remove_file(&temp_path);
            return Err(e);
        }

        // Rename temp file to final
        if let Err(e) = std::fs::rename(&temp_path, &dest_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ModelError::Io(e));
        }

        app.emit(
            "download-complete",
            DownloadComplete {
                model_id: model_id.to_string(),
            },
        )
        .ok();

        Ok(dest_path)
    }
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    model_id: String,
    progress: u32,
    downloaded_mb: u64,
    total_mb: u64,
}

#[derive(Clone, Serialize)]
struct DownloadComplete {
    model_id: String,
}
