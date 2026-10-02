use crate::audio;
use rodio::buffer::SamplesBuffer;
use rodio::{OutputStream, OutputStreamHandle, Source};
use std::f32::consts::PI;
use std::sync::mpsc::{self, Receiver, Sender};

const SAMPLE_RATE: u32 = 44100;

/// Pre-computed sound buffers for instant playback.
/// All presets are generated once at startup and stored in RAM.
///
/// The `OutputStream` (which is `!Send`) never leaves the thread that owns it, and
/// samples reach it through a channel. That thread reopens the stream when the device
/// underneath has changed, which is what makes a headset plugged in halfway through a
/// session hear the sounds: the stream itself stays bound to the endpoint it was opened
/// on, so following Windows means opening a new one.
pub struct SoundEngine {
    commands: Sender<Command>,
    start_beep: Vec<f32>,
    stop_beep: Vec<f32>,
    start_click: Vec<f32>,
    stop_click: Vec<f32>,
    start_chime: Vec<f32>,
    stop_chime: Vec<f32>,
    refused: Vec<f32>,
}

enum Command {
    Play(Vec<f32>),
    UseDevice(Option<String>),
}

/// The output the worker thread is holding open.
struct Output {
    /// Dropped with the struct, which is what closes the stream on the old device
    _stream: OutputStream,
    handle: OutputStreamHandle,
    device_name: String,
}

impl SoundEngine {
    pub fn new() -> Option<Self> {
        let (commands, rx) = mpsc::channel();

        std::thread::Builder::new()
            .name("sound-output".into())
            .spawn(move || run_output(rx))
            .ok()?;

        Some(Self {
            commands,
            start_beep: gen_tone(880.0, 0.1, 0.10, 0.01, Waveform::Sine),
            stop_beep: gen_tone(440.0, 0.15, 0.10, 0.01, Waveform::Sine),
            start_click: gen_tone(1000.0, 0.05, 0.08, 0.001, Waveform::Square),
            stop_click: gen_tone(800.0, 0.05, 0.08, 0.001, Waveform::Square),
            start_chime: gen_sweep(523.25, 659.25, 0.3, 0.12, 0.01),
            stop_chime: gen_sweep(659.25, 523.25, 0.3, 0.12, 0.01),
            refused: gen_refusal(),
        })
    }

    /// Play on `device_name`, or on whatever Windows calls the default when it is
    /// `None`. A device that is named but absent falls back to the default too, so
    /// unplugging the headset it names does not leave the app silent.
    pub fn set_device(&self, device_name: Option<String>) {
        let _ = self.commands.send(Command::UseDevice(device_name));
    }

    pub fn play(&self, sound_type: &str, preset: &str) {
        let samples = match (sound_type, preset) {
            // One sound whatever the preset: it has to read as a refusal, not
            // as a quieter version of the start.
            ("refused", _) => &self.refused,
            ("start", "beep") => &self.start_beep,
            ("stop", "beep") => &self.stop_beep,
            ("start", "click") => &self.start_click,
            ("stop", "click") => &self.stop_click,
            ("start", "chime") => &self.start_chime,
            ("stop", "chime") => &self.stop_chime,
            _ => return,
        };

        let _ = self.commands.send(Command::Play(samples.clone()));
    }
}

/// Owns the output stream and answers commands until the engine is dropped.
fn run_output(commands: Receiver<Command>) {
    let mut preferred: Option<String> = None;
    let mut output: Option<Output> = None;

    while let Ok(command) = commands.recv() {
        match command {
            Command::UseDevice(device_name) => {
                preferred = device_name;
                // Reopened on the next sound rather than here: nothing is playing, and
                // the device asked for may not be plugged in yet.
                output = None;
            }
            Command::Play(samples) => {
                // Asking for the name costs a call on every sound, and it is the only
                // thing that notices a headset arriving: Windows moves the default, the
                // name stops matching, and the stream is opened again on the new one.
                // An enumeration that answers nothing, which happens for a moment while
                // Windows moves devices around, leaves the open stream alone: playing on
                // it beats dropping one that works, and the next sound asks again.
                if let Some((device, device_name)) =
                    audio::find_output_device(preferred.as_deref())
                {
                    let same_device = output
                        .as_ref()
                        .map(|output| output.device_name == device_name)
                        .unwrap_or(false);

                    if !same_device {
                        output = OutputStream::try_from_device(&device).ok().map(
                            |(stream, handle)| Output {
                                _stream: stream,
                                handle,
                                device_name,
                            },
                        );
                    }
                }

                if let Some(output) = &output {
                    let buffer = SamplesBuffer::new(1, SAMPLE_RATE, samples);
                    let _ = output.handle.play_raw(buffer.convert_samples());
                }
            }
        }
    }
}

enum Waveform {
    Sine,
    Square,
}

/// Two short low notes, the second lower: the "no" a start beep never sounds like.
fn gen_refusal() -> Vec<f32> {
    let mut samples = gen_tone(330.0, 0.08, 0.12, 0.04, Waveform::Sine);
    samples.extend(std::iter::repeat(0.0).take((SAMPLE_RATE as f32 * 0.06) as usize));
    samples.extend(gen_tone(247.0, 0.12, 0.12, 0.01, Waveform::Sine));
    samples
}

fn gen_tone(freq: f32, duration: f32, gain_start: f32, gain_end: f32, waveform: Waveform) -> Vec<f32> {
    let num_samples = (SAMPLE_RATE as f32 * duration) as usize;
    let mut samples = Vec::with_capacity(num_samples);

    for i in 0..num_samples {
        let t = i as f32 / SAMPLE_RATE as f32;
        let progress = t / duration;

        let wave = match waveform {
            Waveform::Sine => (2.0 * PI * freq * t).sin(),
            Waveform::Square => {
                if (2.0 * PI * freq * t).sin() > 0.0 {
                    1.0
                } else {
                    -1.0
                }
            }
        };

        let gain = gain_start * (gain_end / gain_start).powf(progress);
        samples.push(wave * gain);
    }

    shape_edges(&mut samples, duration);
    samples
}

/// Fade both ends of a buffer so the sound starts and stops on silence.
///
/// The decay alone is not enough. A wave that opens at full amplitude, which a
/// square one does by definition, puts a step in the signal, and a buffer that
/// stops mid-cycle puts another one at the end. A speaker reproduces each as a
/// click, which is what makes a short tone sound mechanical rather than played.
///
/// The attack stays short so the sound still feels immediate, the release is
/// longer since that is the end nobody is waiting on, and both are capped for a
/// long sound and taken as a share of a short one, so a fifty millisecond click
/// is shaped rather than swallowed.
fn shape_edges(samples: &mut [f32], duration: f32) {
    let attack = (duration * 0.15).min(0.012);
    let release = (duration * 0.35).min(0.040);

    let len = samples.len();
    if len == 0 {
        return;
    }

    let attack_samples = ((SAMPLE_RATE as f32 * attack) as usize).min(len / 2);
    let release_samples = ((SAMPLE_RATE as f32 * release) as usize).min(len / 2);

    // A raised cosine rather than a straight line: the corner where a linear
    // ramp meets the note is itself audible on a sound this short.
    for i in 0..attack_samples {
        let progress = (i as f32 + 0.5) / attack_samples as f32;
        samples[i] *= 0.5 - 0.5 * (PI * progress).cos();
    }

    for i in 0..release_samples {
        let progress = (i as f32 + 0.5) / release_samples as f32;
        samples[len - 1 - i] *= 0.5 - 0.5 * (PI * progress).cos();
    }
}

fn gen_sweep(
    freq_start: f32,
    freq_end: f32,
    duration: f32,
    gain_start: f32,
    gain_end: f32,
) -> Vec<f32> {
    let num_samples = (SAMPLE_RATE as f32 * duration) as usize;
    let mut samples = Vec::with_capacity(num_samples);

    for i in 0..num_samples {
        let t = i as f32 / SAMPLE_RATE as f32;
        let progress = t / duration;

        // Phase-correct frequency sweep via integration
        let phase = 2.0 * PI * (freq_start * t + (freq_end - freq_start) * t * t / (2.0 * duration));
        let wave = phase.sin();

        let gain = gain_start * (gain_end / gain_start).powf(progress);
        samples.push(wave * gain);
    }

    shape_edges(&mut samples, duration);
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    // SoundEngine::new() opens an output device, which a machine running tests
    // may not have. What is testable without one is the generation, which is
    // where a wrong number turns into a click or a burst of noise.

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
    }

    #[test]
    fn a_tone_lasts_as_long_as_it_was_asked_to() {
        let samples = gen_tone(880.0, 0.1, 0.1, 0.01, Waveform::Sine);
        assert_eq!(samples.len(), (SAMPLE_RATE as f32 * 0.1) as usize);
    }

    #[test]
    fn a_tone_never_exceeds_its_starting_gain() {
        // Anything above 1.0 clips on the way out, and the gain only ever decays.
        let samples = gen_tone(880.0, 0.1, 0.10, 0.01, Waveform::Sine);
        assert!(peak(&samples) <= 0.10 + 1e-6, "peak was {}", peak(&samples));
    }

    #[test]
    fn a_tone_fades_rather_than_cutting_off() {
        // A buffer that stops at full amplitude is heard as a click.
        let samples = gen_tone(880.0, 0.1, 0.10, 0.01, Waveform::Sine);
        let tail = &samples[samples.len() - 100..];
        assert!(peak(tail) < 0.02, "the tail was still at {}", peak(tail));
    }

    #[test]
    fn a_square_wave_only_ever_sits_at_the_gain_or_its_negative() {
        let samples = gen_tone(1000.0, 0.05, 0.08, 0.001, Waveform::Square);
        for s in &samples {
            let magnitude = s.abs();
            assert!(magnitude <= 0.08 + 1e-6, "{} is above the gain", s);
        }
        // And it does swing both ways, rather than sitting on one rail.
        assert!(samples.iter().any(|&s| s > 0.0));
        assert!(samples.iter().any(|&s| s < 0.0));
    }

    #[test]
    fn a_sweep_lasts_as_long_as_it_was_asked_to() {
        let samples = gen_sweep(523.25, 659.25, 0.3, 0.12, 0.01);
        assert_eq!(samples.len(), (SAMPLE_RATE as f32 * 0.3) as usize);
    }

    #[test]
    fn a_sweep_stays_finite_in_both_directions() {
        // The phase is integrated rather than stepped, so a descending sweep has
        // a negative term in it. Getting that wrong gives NaN, which rodio plays
        // as a burst of noise.
        for (start, end) in [(523.25, 659.25), (659.25, 523.25)] {
            let samples = gen_sweep(start, end, 0.3, 0.12, 0.01);
            assert!(
                samples.iter().all(|s| s.is_finite()),
                "{} to {} produced a non-finite sample",
                start,
                end
            );
            assert!(peak(&samples) <= 0.12 + 1e-6);
        }
    }

    #[test]
    fn a_sweep_starts_from_silence_rather_than_a_step() {
        let samples = gen_sweep(523.25, 659.25, 0.3, 0.12, 0.01);
        assert!(samples[0].abs() < 1e-3, "it opened at {}", samples[0]);
    }

    #[test]
    fn every_preset_opens_and_closes_on_silence() {
        // The square wave is the one that made this audible: it opens at full
        // amplitude by construction, which is heard as a click over the note.
        let presets = [
            gen_tone(880.0, 0.1, 0.10, 0.01, Waveform::Sine),
            gen_tone(1000.0, 0.05, 0.08, 0.001, Waveform::Square),
            gen_sweep(523.25, 659.25, 0.3, 0.12, 0.01),
            gen_refusal(),
        ];

        for samples in presets {
            assert!(samples[0].abs() < 1e-4, "it opened at {}", samples[0]);
            let last = samples[samples.len() - 1];
            assert!(last.abs() < 1e-4, "it closed at {}", last);
        }
    }

    #[test]
    fn the_shaping_leaves_the_middle_of_a_sound_alone() {
        // Fading the ends is not the same as turning the sound down: what is
        // between them has to come out at the gain it was asked for.
        let samples = gen_tone(880.0, 0.1, 0.10, 0.01, Waveform::Sine);
        let middle = &samples[samples.len() / 4..samples.len() / 2];
        assert!(peak(middle) > 0.03, "the middle peaked at {}", peak(middle));
    }
}
