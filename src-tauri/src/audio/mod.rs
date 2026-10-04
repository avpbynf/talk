use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("No input device available")]
    NoInputDevice,
    #[error("Failed to get device config: {0}")]
    DeviceConfig(String),
    #[error("Failed to build stream: {0}")]
    BuildStream(String),
    #[error("Failed to start stream: {0}")]
    StartStream(String),
}

const WHISPER_SAMPLE_RATE: u32 = 16000;

/// Maximum buffer size: ~10 minutes of audio at 16kHz (16000 samples/sec * 600 sec)
const MAX_BUFFER_SAMPLES: usize = 9_600_000;

/// Thread-safe audio buffer that can be shared across threads
///
/// Past the cap it keeps the newest ten minutes. It is a ring: a push only
/// ever moves what it adds, so the capture callback never pays for the length
/// of the recording.
#[derive(Clone)]
pub struct AudioBuffer {
    data: Arc<Mutex<VecDeque<f32>>>,
}

impl AudioBuffer {
    pub fn new() -> Self {
        Self {
            data: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn push(&self, samples: &[f32]) {
        let mut data = self.data.lock();
        // A single push larger than the cap only keeps its own tail.
        let samples = &samples[samples.len().saturating_sub(MAX_BUFFER_SAMPLES)..];
        let overflow = (data.len() + samples.len()).saturating_sub(MAX_BUFFER_SAMPLES);
        data.drain(..overflow);
        data.extend(samples);
    }

    /// Everything recorded so far, oldest first, leaving the buffer empty.
    ///
    /// The ring is swapped out under the lock and laid flat after it is
    /// released: once it has wrapped that is a move of tens of megabytes, and
    /// the capture callback waits on the same lock. What arrives meanwhile
    /// lands in the fresh buffer, as it would have after the take.
    pub fn take(&self) -> Vec<f32> {
        let ring = std::mem::take(&mut *self.data.lock());
        Vec::from(ring)
    }

    /// Get multiple audio levels for spectrum visualization
    /// Returns `num_bars` levels, each representing a time slice of recent audio
    pub fn get_spectrum(&self, num_bars: usize) -> Vec<f32> {
        // Use last 200ms of audio, divided into num_bars segments. Only that
        // window is copied, on the stack, and the lock is let go before any of
        // the arithmetic.
        const WINDOW: usize = (WHISPER_SAMPLE_RATE as usize) / 5;
        let mut window = [0.0f32; WINDOW];
        let copied = {
            let buffer = self.data.lock();
            let copied = buffer.len().min(WINDOW);
            for (slot, sample) in window.iter_mut().zip(buffer.range(buffer.len() - copied..)) {
                *slot = *sample;
            }
            copied
        };

        if copied == 0 || num_bars == 0 {
            return vec![0.0; num_bars];
        }
        let recent = &window[..copied];

        let samples_per_bar = (recent.len() / num_bars).max(1);
        let mut levels = Vec::with_capacity(num_bars);

        for i in 0..num_bars {
            let bar_start = i * samples_per_bar;
            let bar_end = ((i + 1) * samples_per_bar).min(recent.len());

            if bar_start >= recent.len() {
                levels.push(0.0);
                continue;
            }

            let slice = &recent[bar_start..bar_end];
            if slice.is_empty() {
                levels.push(0.0);
                continue;
            }

            // Calculate RMS for this segment
            let sum_sq: f32 = slice.iter().map(|s| s * s).sum();
            let rms = (sum_sq / slice.len() as f32).sqrt();

            // Normalize and amplify for better visualization (0.0 to 1.0)
            // Typical speech RMS is around 0.01-0.1, amplify significantly
            let normalized = (rms * 15.0).min(1.0);
            levels.push(normalized);
        }

        levels
    }
}

/// Handle to stop audio capture - when dropped or stop() called, the stream is cleaned up
#[derive(Clone)]
pub struct AudioCaptureHandle {
    stop_signal: Arc<AtomicBool>,
}

impl AudioCaptureHandle {
    /// Signal the audio stream to stop
    pub fn stop(&self) {
        self.stop_signal.store(true, Ordering::SeqCst);
    }
}

impl Drop for AudioCaptureHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// List available input devices (microphones).
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// The name Windows reports for the default input, when there is one.
pub fn default_input_device_name() -> Option<String> {
    cpal::default_host().default_input_device()?.name().ok()
}

/// List available output devices (speakers, headsets).
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// The name Windows reports for the default output, when there is one.
pub fn default_output_device_name() -> Option<String> {
    cpal::default_host().default_output_device()?.name().ok()
}

/// Find an output device by name, or fall back to the system default, and answer with
/// the name it goes by. The name is what tells a caller holding a stream open whether
/// the device under it has changed.
pub fn find_output_device(device_name: Option<&str>) -> Option<(cpal::Device, String)> {
    let host = cpal::default_host();

    if let Some(name) = device_name {
        if let Some(device) = host.output_devices().ok().and_then(|mut devices| {
            devices.find(|d| d.name().map(|n| n == name).unwrap_or(false))
        }) {
            return Some((device, name.to_string()));
        }
    }

    let device = host.default_output_device()?;
    let name = device.name().ok()?;
    Some((device, name))
}

/// Find an input device by name, or fall back to the system default.
fn find_input_device(device_name: Option<&str>) -> Result<cpal::Device, AudioError> {
    let host = cpal::default_host();

    if let Some(name) = device_name {
        if let Some(device) = host.input_devices().ok().and_then(|mut devices| {
            devices.find(|d| d.name().map(|n| n == name).unwrap_or(false))
        }) {
            return Ok(device);
        }
        eprintln!("Input device '{}' not found, falling back to default", name);
    }

    host.default_input_device().ok_or(AudioError::NoInputDevice)
}

/// Starts audio capture and returns a buffer and handle to stop it.
/// If `device_name` is Some, uses that device; otherwise uses the system default.
pub fn start_capture_device(device_name: Option<&str>) -> Result<(AudioBuffer, AudioCaptureHandle), AudioError> {
    let device = find_input_device(device_name)?;
    start_capture_with_device(device)
}

fn start_capture_with_device(device: cpal::Device) -> Result<(AudioBuffer, AudioCaptureHandle), AudioError> {
    use std::sync::mpsc;

    let buffer = AudioBuffer::new();
    let buffer_clone = buffer.clone();
    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_signal_clone = stop_signal.clone();

    // Channel to receive initialization result from the audio thread
    let (tx, rx) = mpsc::channel::<Result<(), AudioError>>();

    // Spawn dedicated thread that owns the stream
    std::thread::spawn(move || {
        let result = (|| -> Result<cpal::Stream, AudioError> {
            let device = device;

            let config = device
                .default_input_config()
                .map_err(|e| AudioError::DeviceConfig(e.to_string()))?;

            let sample_rate = config.sample_rate().0;
            let channels = config.channels() as usize;

            let stream = match config.sample_format() {
                SampleFormat::F32 => build_stream::<f32>(
                    &device,
                    &config.into(),
                    buffer_clone,
                    sample_rate,
                    WHISPER_SAMPLE_RATE,
                    channels,
                )?,
                SampleFormat::I16 => build_stream::<i16>(
                    &device,
                    &config.into(),
                    buffer_clone,
                    sample_rate,
                    WHISPER_SAMPLE_RATE,
                    channels,
                )?,
                SampleFormat::U16 => build_stream::<u16>(
                    &device,
                    &config.into(),
                    buffer_clone,
                    sample_rate,
                    WHISPER_SAMPLE_RATE,
                    channels,
                )?,
                _ => return Err(AudioError::DeviceConfig("Unsupported sample format".into())),
            };

            stream
                .play()
                .map_err(|e| AudioError::StartStream(e.to_string()))?;

            Ok(stream)
        })();

        match result {
            Ok(stream) => {
                // Signal success
                let _ = tx.send(Ok(()));

                // Keep stream alive until stop signal
                while !stop_signal_clone.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }

                // Stream is dropped here when loop exits
                drop(stream);
            }
            Err(e) => {
                let _ = tx.send(Err(e));
            }
        }
    });

    // Wait for initialization result
    rx.recv()
        .map_err(|_| AudioError::BuildStream("Audio thread failed to start".to_string()))??;

    let handle = AudioCaptureHandle { stop_signal };

    Ok((buffer, handle))
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buffer: AudioBuffer,
    input_sample_rate: u32,
    target_sample_rate: u32,
    channels: usize,
) -> Result<cpal::Stream, AudioError>
where
    T: cpal::Sample + cpal::SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    let resample_ratio = target_sample_rate as f64 / input_sample_rate as f64;
    let mut resample_buffer: Vec<f32> = Vec::new();
    let mut resample_pos: f64 = 0.0;

    let stream = device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                // Convert to f32 and mono
                let mono_samples: Vec<f32> = data
                    .chunks(channels)
                    .map(|frame| {
                        let sum: f32 = frame.iter().map(|s| s.to_sample::<f32>()).sum();
                        sum / channels as f32
                    })
                    .collect();

                // Simple linear resampling to 16kHz
                resample_buffer.extend(mono_samples.iter());

                let mut resampled = Vec::new();
                while resample_pos < resample_buffer.len() as f64 - 1.0 {
                    let idx = resample_pos as usize;
                    let frac = resample_pos - idx as f64;
                    let sample = resample_buffer[idx] * (1.0 - frac as f32)
                        + resample_buffer[idx + 1] * frac as f32;
                    resampled.push(sample);
                    resample_pos += 1.0 / resample_ratio;
                }

                // Keep remainder for next callback
                let consumed = resample_pos as usize;
                if consumed > 0 && consumed < resample_buffer.len() {
                    resample_buffer.drain(0..consumed);
                    resample_pos -= consumed as f64;
                } else if consumed > 0 {
                    resample_buffer.clear();
                    resample_pos = 0.0;
                }

                // Add to buffer
                buffer.push(&resampled);
            },
            |err| eprintln!("Audio stream error: {}", err),
            None,
        )
        .map_err(|e| AudioError::BuildStream(e.to_string()))?;

    Ok(stream)
}

#[cfg(test)]
mod tests;
