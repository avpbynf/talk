use std::path::Path;
use thiserror::Error;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Error, Debug)]
pub enum TranscriptionError {
    #[error("Failed to load model: {0}")]
    ModelLoad(String),
    #[error("Failed to create state: {0}")]
    StateCreation(String),
    #[error("Transcription failed: {0}")]
    Transcription(String),
}

/// GPU backend for simplified selection
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpuVendor {
    Vulkan, // AMD, Intel, or NVIDIA
    #[serde(other)]
    Cpu,    // Fallback
}

impl Default for GpuVendor {
    fn default() -> Self {
        Self::Cpu
    }
}

impl std::fmt::Display for GpuVendor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GpuVendor::Vulkan => write!(f, "Vulkan (AMD/Intel)"),
            GpuVendor::Cpu => write!(f, "CPU"),
        }
    }
}

// Keep old enum for backwards compatibility with settings
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceleratorBackend {
    Vulkan,
    #[serde(other)]
    Cpu,
}

impl Default for AcceleratorBackend {
    fn default() -> Self {
        Self::Cpu
    }
}

impl AcceleratorBackend {
    /// Convert from GpuVendor to the appropriate backend
    pub fn from_vendor(vendor: GpuVendor) -> Self {
        match vendor {
            GpuVendor::Vulkan => AcceleratorBackend::Vulkan,
            GpuVendor::Cpu => AcceleratorBackend::Cpu,
        }
    }
}

impl std::fmt::Display for AcceleratorBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AcceleratorBackend::Cpu => write!(f, "CPU"),
            AcceleratorBackend::Vulkan => write!(f, "GPU (Vulkan)"),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GpuInfo {
    pub vendor: GpuVendor,
    pub name: String,
    pub available: bool,
    pub description: String,
}

// Keep old struct for compatibility
#[derive(Debug, Clone, serde::Serialize)]
pub struct AcceleratorInfo {
    pub backend: AcceleratorBackend,
    pub name: String,
    pub available: bool,
    pub description: String,
}

/// Detect available GPU backends
pub fn detect_available_gpus() -> Vec<GpuInfo> {
    let mut gpus = vec![];

    // Vulkan (AMD, Intel, or NVIDIA)
    #[cfg(feature = "vulkan")]
    {
        gpus.push(GpuInfo {
            vendor: GpuVendor::Vulkan,
            name: "Vulkan".to_string(),
            available: true, // Vulkan is generally available if compiled
            description: "AMD, Intel or NVIDIA".to_string(),
        });
    }

    #[cfg(not(feature = "vulkan"))]
    {
        gpus.push(GpuInfo {
            vendor: GpuVendor::Vulkan,
            name: "Vulkan".to_string(),
            available: false,
            description: "Built without Vulkan".to_string(),
        });
    }

    // CPU fallback
    gpus.push(GpuInfo {
        vendor: GpuVendor::Cpu,
        name: "CPU".to_string(),
        available: true,
        description: "Slower, and always there".to_string(),
    });

    gpus
}

/// Detect available accelerators on the system (legacy, for compatibility)
pub fn detect_available_accelerators() -> Vec<AcceleratorInfo> {
    detect_available_gpus()
        .into_iter()
        .map(|gpu| AcceleratorInfo {
            backend: AcceleratorBackend::from_vendor(gpu.vendor),
            name: gpu.name,
            available: gpu.available,
            description: gpu.description,
        })
        .collect()
}

/// Get the best available accelerator (auto-detection)
pub fn get_best_accelerator() -> AcceleratorBackend {
    #[cfg(feature = "vulkan")]
    { return AcceleratorBackend::Vulkan; }

    #[cfg(not(feature = "vulkan"))]
    { AcceleratorBackend::Cpu }
}

/// A GPU the local engine can be pointed at.
///
/// `index` is what whisper.cpp calls `gpu_device`: it walks the ggml device registry
/// counting the GPUs it finds, so the number is a position among the GPUs and not a
/// position in the registry.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct GpuDevice {
    pub index: u32,
    pub name: String,
    pub vram_mb: u64,
    /// An integrated chip shares system memory, and reports it as if it were its own
    pub integrated: bool,
}

/// The GPU picked in the settings file. An index on its own would drift the day a card
/// is added or a driver stops reporting one, so the name travels with it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GpuDevicePreference {
    pub index: u32,
    pub name: String,
}

/// Enumerate the GPUs in the order whisper indexes them.
#[cfg(feature = "vulkan")]
pub fn list_gpu_devices() -> Vec<GpuDevice> {
    use std::ffi::CStr;
    use whisper_rs::whisper_rs_sys as sys;

    let mut devices: Vec<GpuDevice> = Vec::new();

    // Going through the registry rather than the Vulkan entry points is what keeps a
    // driver that cannot start from taking the process down: the registry builds the
    // Vulkan backend inside a catch and reports no device when it throws.
    unsafe {
        for i in 0..sys::ggml_backend_dev_count() {
            let device = sys::ggml_backend_dev_get(i);
            if device.is_null() {
                continue;
            }

            let device_type = sys::ggml_backend_dev_type(device);
            if device_type != sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU
                && device_type != sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU
            {
                continue;
            }

            let index = devices.len() as u32;
            let integrated = device_type == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU;
            let description = sys::ggml_backend_dev_description(device);
            let name = if description.is_null() {
                String::new()
            } else {
                CStr::from_ptr(description).to_string_lossy().trim().to_string()
            };

            let mut free = 0usize;
            let mut total = 0usize;
            sys::ggml_backend_dev_memory(device, &mut free, &mut total);

            devices.push(GpuDevice {
                index,
                name: if name.is_empty() {
                    format!("GPU {}", index)
                } else {
                    name
                },
                vram_mb: (total / (1024 * 1024)) as u64,
                integrated,
            });
        }
    }

    devices
}

#[cfg(not(feature = "vulkan"))]
pub fn list_gpu_devices() -> Vec<GpuDevice> {
    Vec::new()
}

/// Turn a saved preference into the index to hand whisper.
pub fn resolve_gpu_device(preference: Option<&GpuDevicePreference>, devices: &[GpuDevice]) -> u32 {
    if devices.is_empty() {
        return 0;
    }

    if let Some(preference) = preference {
        if let Some(device) = devices
            .iter()
            .find(|device| device.index == preference.index && device.name == preference.name)
            .or_else(|| devices.iter().find(|device| device.name == preference.name))
        {
            return device.index;
        }
    }

    // Nothing saved, or the card is gone. Which card Vulkan lists first depends on the
    // driver and on what Windows was told to prefer, so position says nothing: take the
    // discrete card, and the roomiest one when there are several. Memory alone would not
    // do, since an integrated chip reports the shared system memory as its own and comes
    // out ahead of a discrete card carrying half as much of its own.
    let mut best = &devices[0];
    for device in &devices[1..] {
        let better_class = !device.integrated && best.integrated;
        let same_class_and_roomier = device.integrated == best.integrated && device.vram_mb > best.vram_mb;
        if better_class || same_class_and_roomier {
            best = device;
        }
    }
    best.index
}


/// One stretch of speech, in seconds from the start of the audio
#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transcript {
    pub segments: Vec<TranscriptSegment>,
    pub language: String,
}

impl Transcript {
    pub fn text(&self) -> String {
        self.segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<String>()
            .trim()
            .to_string()
    }
}

pub struct WhisperEngine {
    ctx: WhisperContext,
    backend: AcceleratorBackend,
}

impl WhisperEngine {
    pub fn new_with_backend(
        model_path: &Path,
        backend: AcceleratorBackend,
        gpu_device: u32,
    ) -> Result<Self, TranscriptionError> {
        let mut params = WhisperContextParameters::default();

        // Configure backend-specific settings
        match backend {
            AcceleratorBackend::Vulkan => {
                #[cfg(feature = "vulkan")]
                {
                    params.use_gpu(true);
                    params.gpu_device(gpu_device as std::os::raw::c_int);
                }
                #[cfg(not(feature = "vulkan"))]
                {
                    // Vulkan not compiled - CPU fallback will be used
                    let _ = gpu_device;
                }
            }
            AcceleratorBackend::Cpu => {
                params.use_gpu(false);
                let _ = gpu_device;
            }
        }

        let model_path_str = model_path
            .to_str()
            .ok_or_else(|| TranscriptionError::ModelLoad("Invalid UTF-8 in model path".to_string()))?;

        let ctx = WhisperContext::new_with_params(
            model_path_str,
            params,
        )
        .map_err(|e| TranscriptionError::ModelLoad(e.to_string()))?;

        Ok(Self { ctx, backend })
    }

    pub fn backend(&self) -> AcceleratorBackend {
        self.backend
    }

    /// Transcribe audio with optional vocabulary hints (initial_prompt)
    /// The vocabulary string helps Whisper recognize specific terms
    ///
    /// `should_abort` is polled by whisper between its steps of work, so a
    /// cancelled run still finishes the step it is in, which on a slow card is
    /// a second or two.
    pub fn transcribe_with_options<F, A>(
        &self,
        audio_data: &[f32],
        vocabulary: Option<&str>,
        on_progress: F,
        mut should_abort: A,
    ) -> Result<String, TranscriptionError>
    where
        F: FnMut(i32) + 'static,
        A: FnMut() -> bool + 'static,
    {
        self.run(
            audio_data,
            Some("fr"),
            vocabulary,
            on_progress,
            Some(Box::new(move || should_abort())),
        )
        .map(|transcript| transcript.text())
    }

    /// Transcribe with the timing of each segment, in the language asked for.
    /// `None` lets whisper detect it, and the transcript says what it found.
    /// Whisper polls `should_abort` as it works and gives up when it says true.
    pub fn transcribe_segments(
        &self,
        audio_data: &[f32],
        language: Option<&str>,
        prompt: Option<&str>,
        should_abort: Box<dyn FnMut() -> bool>,
    ) -> Result<Transcript, TranscriptionError> {
        self.run(audio_data, language, prompt, |_| {}, Some(should_abort))
    }

    fn run<F>(
        &self,
        audio_data: &[f32],
        language: Option<&str>,
        vocabulary: Option<&str>,
        mut on_progress: F,
        should_abort: Option<Box<dyn FnMut() -> bool>>,
    ) -> Result<Transcript, TranscriptionError>
    where
        F: FnMut(i32) + 'static,
    {
        // whisper-rs turns these into C strings and panics on a NUL byte, which
        // aborts the whole process in a release build
        let language = language.map(without_nul);
        let language = language.as_deref();
        let vocabulary = vocabulary.map(without_nul);
        let vocabulary = vocabulary.as_deref();

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| TranscriptionError::StateCreation(e.to_string()))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Configure for optimal performance
        params.set_n_threads(threads_for(num_cpus::get()));
        params.set_language(language);
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);

        // Set vocabulary hints via initial_prompt
        // This biases Whisper toward recognizing these specific terms
        if let Some(vocab) = vocabulary {
            if !vocab.is_empty() {
                params.set_initial_prompt(vocab);
            }
        }

        // Set progress callback
        params.set_progress_callback_safe(move |progress| {
            on_progress(progress);
        });

        // Boxed on purpose. whisper-rs 0.16 stores the closure as a boxed
        // trait object but registers a trampoline that reads it back as the
        // closure's own type, so a bare closure is called on the wrong data.
        // When the closure is itself that trait object the two agree.
        if let Some(should_abort) = should_abort {
            params.set_abort_callback_safe::<_, Box<dyn FnMut() -> bool>>(should_abort);
        }

        // Run transcription
        state
            .full(params, audio_data)
            .map_err(|e| TranscriptionError::Transcription(e.to_string()))?;

        let num_segments = state.full_n_segments();
        let mut segments = Vec::new();

        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(text) = segment.to_str() {
                    segments.push(TranscriptSegment {
                        // Whisper counts in hundredths of a second
                        start: segment.start_timestamp() as f64 / 100.0,
                        end: segment.end_timestamp() as f64 / 100.0,
                        text: text.to_string(),
                    });
                }
            }
        }

        let language = match language {
            Some(code) => code.to_string(),
            None => whisper_rs::get_lang_str(state.full_lang_id_from_state())
                .unwrap_or("en")
                .to_string(),
        };

        Ok(Transcript { segments, language })
    }
}

fn without_nul(text: &str) -> String {
    text.replace('\0', "")
}

/// Half the cores, and never none: zero would leave the choice to whisper on a
/// single-core machine.
fn threads_for(cores: usize) -> i32 {
    (cores / 2).max(1) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_core_still_gets_a_thread() {
        assert_eq!(threads_for(1), 1);
        assert_eq!(threads_for(2), 1);
        assert_eq!(threads_for(3), 1);
        assert_eq!(threads_for(16), 8);
    }

    #[test]
    fn a_nul_byte_is_dropped_before_it_reaches_whisper() {
        assert_eq!(without_nul("fr\0en"), "fren");
        assert_eq!(without_nul("plain"), "plain");
    }

    fn device(index: u32, name: &str, vram_mb: u64) -> GpuDevice {
        GpuDevice {
            index,
            name: name.to_string(),
            vram_mb,
            integrated: false,
        }
    }

    fn integrated_device(index: u32, name: &str, vram_mb: u64) -> GpuDevice {
        GpuDevice {
            integrated: true,
            ..device(index, name, vram_mb)
        }
    }

    fn preference(index: u32, name: &str) -> GpuDevicePreference {
        GpuDevicePreference {
            index,
            name: name.to_string(),
        }
    }

    #[test]
    fn picks_the_largest_card_when_nothing_is_saved() {
        let devices = vec![
            device(0, "Radeon RX 7600", 8192),
            device(1, "Radeon RX 7800 XT", 16384),
        ];
        assert_eq!(resolve_gpu_device(None, &devices), 1);
    }

    #[test]
    fn leaves_the_integrated_chip_alone_however_much_memory_it_claims() {
        // What this machine reports: the shared memory of the integrated chip is twice
        // what the discrete card carries, and it is still the slower of the two.
        let devices = vec![
            device(0, "NVIDIA GeForce RTX 4060 Laptop GPU", 7956),
            integrated_device(1, "Intel(R) Iris(R) Xe Graphics", 16197),
        ];
        assert_eq!(resolve_gpu_device(None, &devices), 0);
    }

    #[test]
    fn takes_the_integrated_chip_when_it_is_all_there_is() {
        let devices = vec![integrated_device(0, "Intel(R) Iris(R) Xe Graphics", 16197)];
        assert_eq!(resolve_gpu_device(None, &devices), 0);
    }

    #[test]
    fn keeps_the_first_of_two_cards_of_equal_size() {
        let devices = vec![
            device(0, "Radeon RX 7800 XT", 16384),
            device(1, "Radeon RX 7800 XT", 16384),
        ];
        assert_eq!(resolve_gpu_device(None, &devices), 0);
    }

    #[test]
    fn follows_the_name_when_the_index_moved() {
        let devices = vec![
            integrated_device(0, "Intel(R) Iris(R) Xe Graphics", 16197),
            device(1, "Radeon RX 7800 XT", 16384),
        ];
        let saved = preference(0, "Radeon RX 7800 XT");
        assert_eq!(resolve_gpu_device(Some(&saved), &devices), 1);
    }

    #[test]
    fn keeps_the_saved_index_when_two_cards_share_a_name() {
        let devices = vec![
            device(0, "Radeon RX 7800 XT", 16384),
            device(1, "Radeon RX 7800 XT", 16384),
        ];
        let saved = preference(1, "Radeon RX 7800 XT");
        assert_eq!(resolve_gpu_device(Some(&saved), &devices), 1);
    }

    #[test]
    fn falls_back_when_the_saved_card_is_gone() {
        let devices = vec![
            integrated_device(0, "Intel(R) Iris(R) Xe Graphics", 16197),
            device(1, "Radeon RX 7800 XT", 16384),
        ];
        let saved = preference(0, "GeForce RTX 4070");
        assert_eq!(resolve_gpu_device(Some(&saved), &devices), 1);
    }

    #[test]
    fn answers_zero_when_there_is_no_gpu() {
        let saved = preference(1, "Radeon RX 7800 XT");
        assert_eq!(resolve_gpu_device(Some(&saved), &[]), 0);
    }
}
