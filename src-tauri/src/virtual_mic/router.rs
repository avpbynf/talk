use cpal::traits::{DeviceTrait, StreamTrait};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

use super::detector::find_vbcable_device;

#[derive(Error, Debug)]
pub enum AudioRouterError {
    #[error("No input device available")]
    NoInputDevice,
    #[error("VB-Cable device not found")]
    VBCableNotFound,
    #[error("The microphone is the virtual cable itself")]
    MicrophoneIsCable,
    #[error("Failed to get device config: {0}")]
    DeviceConfig(String),
    #[error("Failed to build stream: {0}")]
    BuildStream(String),
    #[error("Failed to start stream: {0}")]
    StartStream(String),
}

/// How often a route on the system default asks Windows which microphone that is.
const DEFAULT_CHECK: std::time::Duration = std::time::Duration::from_secs(2);

/// Why a route no longer does what it was started for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RouteEnd {
    /// A stream failed: nothing reaches the cable any more.
    Lost,
    /// The route is on the system default, and Windows now names another microphone.
    /// A stream stays on the endpoint it was opened on, so the route has to be opened again.
    DefaultMoved,
}

/// Audio routing engine. Captures from the microphone Talk records from
/// and plays to the VB-Cable Input device.
pub struct AudioRouter {
    stop_signal: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    lost: Arc<AtomicBool>,
    microphone: String,
}

impl AudioRouter {
    /// Start routing real mic -> VB-Cable Input, from the named microphone or the
    /// system default, which is the choice a dictation makes too, and silent from the
    /// first sample when `muted`. `on_end` is called from one of the router's own
    /// threads, at most once for each reason, when the route stops doing that.
    /// Spawns a dedicated thread that owns both cpal streams.
    pub fn start(
        microphone: Option<&str>,
        muted: bool,
        on_end: impl Fn(RouteEnd) + Send + Sync + 'static,
    ) -> Result<Self, AudioRouterError> {
        let stop_signal = Arc::new(AtomicBool::new(false));
        let muted = Arc::new(AtomicBool::new(muted));
        let lost = Arc::new(AtomicBool::new(false));
        let on_end = Arc::new(on_end);

        let stop_clone = stop_signal.clone();
        let muted_clone = muted.clone();

        // Find devices before spawning thread
        let follows_default = microphone.is_none();
        let input_device = crate::audio::find_input_device(microphone)
            .map_err(|_| AudioRouterError::NoInputDevice)?;
        let microphone = input_device
            .name()
            .map_err(|e| AudioRouterError::DeviceConfig(e.to_string()))?;
        // The cable's own recording side fed back into the cable is a loop.
        if microphone.contains("CABLE Output") {
            return Err(AudioRouterError::MicrophoneIsCable);
        }
        let output_device =
            find_vbcable_device().ok_or(AudioRouterError::VBCableNotFound)?;

        let report_lost = {
            let lost = lost.clone();
            let on_end = on_end.clone();
            Arc::new(move |side: &str, err: cpal::StreamError| {
                eprintln!("Virtual mic {} error: {}", side, err);
                if !lost.swap(true, Ordering::SeqCst) {
                    on_end(RouteEnd::Lost);
                }
            })
        };
        let routed = microphone.clone();
        let input_lost = report_lost.clone();
        let output_lost = report_lost;

        // Get configs
        let input_config = input_device
            .default_input_config()
            .map_err(|e| AudioRouterError::DeviceConfig(e.to_string()))?;
        let output_config = output_device
            .default_output_config()
            .map_err(|e| AudioRouterError::DeviceConfig(e.to_string()))?;

        let input_rate = input_config.sample_rate().0;
        let output_rate = output_config.sample_rate().0;
        let input_channels = input_config.channels() as usize;
        let output_channels = output_config.channels() as usize;

        // Ring buffer to pass audio between input and output callbacks
        let ring = Arc::new(Mutex::new(Vec::<f32>::with_capacity(4096)));
        let ring_writer = ring.clone();
        let ring_reader = ring.clone();

        // Channel to receive initialization result
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), AudioRouterError>>();

        std::thread::spawn(move || {
            let result = (|| -> Result<(cpal::Stream, cpal::Stream), AudioRouterError> {
                // Resampling state
                let resample_ratio = output_rate as f64 / input_rate as f64;
                let resample_buf: Arc<Mutex<Vec<f32>>> =
                    Arc::new(Mutex::new(Vec::new()));
                let resample_pos: Arc<Mutex<f64>> = Arc::new(Mutex::new(0.0));

                let resample_buf_clone = resample_buf.clone();
                let resample_pos_clone = resample_pos.clone();

                // Build input stream - capture from real mic
                let input_stream = input_device
                    .build_input_stream(
                        &input_config.into(),
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            // Convert to mono
                            let mono: Vec<f32> = data
                                .chunks(input_channels)
                                .map(|frame| {
                                    let sum: f32 = frame.iter().sum();
                                    sum / input_channels as f32
                                })
                                .collect();

                            // If muted, write silence
                            let samples = if muted_clone.load(Ordering::Relaxed) {
                                vec![0.0f32; mono.len()]
                            } else {
                                mono
                            };

                            // Resample to output rate if needed
                            if input_rate == output_rate {
                                let expanded: Vec<f32> = samples
                                    .iter()
                                    .flat_map(|&s| std::iter::repeat_n(s, output_channels))
                                    .collect();
                                let mut ring = ring_writer.lock();
                                ring.extend_from_slice(&expanded);
                                if ring.len() > 96_000 {
                                    let drain_to = ring.len() - 48_000;
                                    ring.drain(0..drain_to);
                                }
                            } else {
                                let mut buf = resample_buf_clone.lock();
                                let mut pos = resample_pos_clone.lock();
                                buf.extend(samples.iter());

                                let mut resampled = Vec::new();
                                while *pos < buf.len() as f64 - 1.0 {
                                    let idx = *pos as usize;
                                    let frac = *pos - idx as f64;
                                    let sample = buf[idx] * (1.0 - frac as f32)
                                        + buf[idx + 1] * frac as f32;
                                    for _ in 0..output_channels {
                                        resampled.push(sample);
                                    }
                                    *pos += 1.0 / resample_ratio;
                                }

                                let consumed = *pos as usize;
                                if consumed > 0 && consumed < buf.len() {
                                    buf.drain(0..consumed);
                                    *pos -= consumed as f64;
                                } else if consumed > 0 {
                                    buf.clear();
                                    *pos = 0.0;
                                }

                                let mut ring = ring_writer.lock();
                                ring.extend_from_slice(&resampled);
                                if ring.len() > 96_000 {
                                    let drain_to = ring.len() - 48_000;
                                    ring.drain(0..drain_to);
                                }
                            }
                        },
                        move |err| input_lost("input", err),
                        None,
                    )
                    .map_err(|e| AudioRouterError::BuildStream(e.to_string()))?;

                // Build output stream - play to VB-Cable Input
                let output_stream = output_device
                    .build_output_stream(
                        &output_config.into(),
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            let mut ring = ring_reader.lock();
                            let available = ring.len().min(data.len());
                            data[..available].copy_from_slice(&ring[..available]);
                            for sample in &mut data[available..] {
                                *sample = 0.0;
                            }
                            ring.drain(0..available);
                        },
                        move |err| output_lost("output", err),
                        None,
                    )
                    .map_err(|e| AudioRouterError::BuildStream(e.to_string()))?;

                input_stream
                    .play()
                    .map_err(|e| AudioRouterError::StartStream(e.to_string()))?;
                output_stream
                    .play()
                    .map_err(|e| AudioRouterError::StartStream(e.to_string()))?;

                Ok((input_stream, output_stream))
            })();

            match result {
                Ok((input_stream, output_stream)) => {
                    let _ = tx.send(Ok(()));
                    let mut watches_default = follows_default;
                    let mut checked = std::time::Instant::now();
                    while !stop_clone.load(Ordering::SeqCst) {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        if watches_default && checked.elapsed() >= DEFAULT_CHECK {
                            checked = std::time::Instant::now();
                            let moved = crate::audio::default_input_device_name()
                                .is_some_and(|name| name != routed);
                            if moved {
                                watches_default = false;
                                on_end(RouteEnd::DefaultMoved);
                            }
                        }
                    }
                    drop(input_stream);
                    drop(output_stream);
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });

        rx.recv()
            .map_err(|_| AudioRouterError::BuildStream("Router thread failed".to_string()))??;

        Ok(Self { stop_signal, muted, lost, microphone })
    }

    /// The microphone being routed, by the name Windows gives it.
    pub fn microphone(&self) -> &str {
        &self.microphone
    }

    /// Whether a stream failed since the start, which leaves the cable silent.
    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst)
    }

    /// Mute: write silence to VB-Cable instead of real audio.
    pub fn mute(&self) {
        self.muted.store(true, Ordering::SeqCst);
    }

    /// Unmute: resume forwarding real audio.
    pub fn unmute(&self) {
        self.muted.store(false, Ordering::SeqCst);
    }

    /// Check if currently muted.
    pub fn is_muted(&self) -> bool {
        self.muted.load(Ordering::SeqCst)
    }

    /// Stop routing and release resources.
    pub fn stop(&self) {
        self.stop_signal.store(true, Ordering::SeqCst);
    }
}

impl Drop for AudioRouter {
    fn drop(&mut self) {
        self.stop();
    }
}
