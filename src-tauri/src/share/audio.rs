use std::io::Cursor;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::default::formats::WavReader;

/// What whisper takes
pub const TARGET_RATE: u32 = 16_000;

/// The longest recording taken, as what the engine would be handed
pub const MAX_SECONDS: u64 = 30 * 60;
const MIN_RATE: u32 = 8_000;
const MAX_RATE: u32 = 192_000;
const MAX_CHANNELS: usize = 8;

#[derive(Debug, PartialEq)]
pub struct DecodeError {
    message: String,
    /// The recording is longer than `MAX_SECONDS`, which is a 413 and not a 400
    pub too_long: bool,
}

impl DecodeError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), too_long: false }
    }

    fn too_long() -> Self {
        Self {
            message: format!("The recording is longer than {} minutes", MAX_SECONDS / 60),
            too_long: true,
        }
    }
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Symphonia divides by the sample rate while probing and while decoding, and
/// a rate of 0 panics, which takes the whole application down in a release
/// build. Anything outside what speech is recorded at is refused first.
fn check_format(rate: u32, channels: usize) -> Result<(), DecodeError> {
    if !(MIN_RATE..=MAX_RATE).contains(&rate) {
        return Err(DecodeError::new(format!(
            "Unsupported sample rate {} Hz, expected {} to {}",
            rate, MIN_RATE, MAX_RATE
        )));
    }
    if channels == 0 || channels > MAX_CHANNELS {
        return Err(DecodeError::new(format!(
            "Unsupported channel count {}, expected 1 to {}",
            channels, MAX_CHANNELS
        )));
    }
    Ok(())
}

fn within_limit(frames: u64, rate: u32) -> bool {
    frames <= rate as u64 * MAX_SECONDS
}

/// What a refused upload is told, in the words Talk-Server uses for a format it
/// does not take
pub const UNSUPPORTED_FORMAT: &str = "File format is not allowed. Allowed: wav";

/// Reads the fmt chunk of a WAV by hand, because the demuxer divides by what
/// it finds there. Also refuses a declared length over the cap before anything
/// is decoded. Only a file that opens with RIFF and WAVE gets this far: the
/// default probe scans forward for any container, and the MP4 and MKV
/// demuxers panic on crafted headers.
fn check_wav_header(bytes: &[u8]) -> Result<(), DecodeError> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(DecodeError::new(UNSUPPORTED_FORMAT));
    }
    let le16 = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let le32 = |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);

    let mut format: Option<(u32, usize)> = None;
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = le32(pos + 4) as usize;
        let body = pos + 8;
        if id == b"fmt " {
            if bytes.len() < body + 16 {
                return Err(DecodeError::new("The WAV header is truncated"));
            }
            let channels = le16(body + 2) as usize;
            let rate = le32(body + 4);
            let block_align = le16(body + 12) as usize;
            check_format(rate, channels)?;
            if block_align == 0 {
                return Err(DecodeError::new("The WAV header has a zero block size"));
            }
            format = Some((rate, block_align));
        } else if id == b"data" {
            if let Some((rate, block_align)) = format {
                // A streamed file declares more than it holds
                let held = size.min(bytes.len() - body);
                if !within_limit((held / block_align) as u64, rate) {
                    return Err(DecodeError::too_long());
                }
            }
            return Ok(());
        }
        pos = body.saturating_add(size).saturating_add(size & 1);
    }
    Ok(())
}

/// Turns a stream of mono samples at one rate into 16 kHz.
///
/// Each output sample is the average of the input stretch it covers, which is
/// what keeps a 48 kHz recording from folding its high end back into the
/// speech band the way plain interpolation would. Going up in rate holds each
/// sample, which is crude and is fine for speech that was narrower than the
/// target to begin with.
struct Resampler {
    step: f64,
    sum: f64,
    filled: f64,
    out: Vec<f32>,
}

impl Resampler {
    fn new(source_rate: u32) -> Self {
        Self {
            step: source_rate as f64 / TARGET_RATE as f64,
            sum: 0.0,
            filled: 0.0,
            out: Vec::new(),
        }
    }

    fn push(&mut self, sample: f32) {
        let sample = sample as f64;
        let mut remaining = 1.0;
        loop {
            let need = self.step - self.filled;
            if remaining >= need - 1e-9 {
                self.sum += sample * need;
                self.out.push((self.sum / self.step) as f32);
                self.sum = 0.0;
                self.filled = 0.0;
                remaining -= need;
                if remaining <= 1e-9 {
                    break;
                }
            } else {
                self.sum += sample * remaining;
                self.filled += remaining;
                break;
            }
        }
    }

    fn finish(mut self) -> Vec<f32> {
        if self.filled > 1e-6 {
            self.out.push((self.sum / self.filled) as f32);
        }
        self.out
    }
}

/// Decode an uploaded file into what the engine takes: mono, 16 kHz, f32.
///
/// Only WAV is taken, and it goes straight to the WAV reader.
pub fn decode_to_mono_16k(bytes: Vec<u8>) -> Result<Vec<f32>, DecodeError> {
    check_wav_header(&bytes)?;

    let stream = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let mut format = WavReader::try_new(stream, &FormatOptions::default())
        .map_err(|e| DecodeError::new(format!("Unreadable WAV file: {}", e)))?;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| DecodeError::new("No audio track found"))?;
    let track_id = track.id;
    // Not every container knows its rate before the first packet, so what is
    // missing here is checked again on the decoded audio
    if let Some(rate) = track.codec_params.sample_rate {
        check_format(rate, track.codec_params.channels.map_or(1, |c| c.count()))?;
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| DecodeError::new(format!("Unsupported audio codec: {}", e)))?;

    let mut resampler: Option<Resampler> = None;
    let mut buffer: Option<SampleBuffer<f32>> = None;
    let mut frames_seen: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            // The end of a stream is reported as an unexpected EOF by most demuxers
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(DecodeError::new(format!("Could not read the audio: {}", e))),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A damaged packet costs a click, not the whole file
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(DecodeError::new(format!("Could not decode the audio: {}", e))),
        };

        let spec = *decoded.spec();
        check_format(spec.rate, spec.channels.count())?;
        // Counted before anything is copied or resampled, so a stream that
        // never ends is cut off here and not after it has filled the memory
        frames_seen += decoded.frames() as u64;
        if !within_limit(frames_seen, spec.rate) {
            return Err(DecodeError::too_long());
        }
        let channels = spec.channels.count();
        let capacity = decoded.capacity() as u64;
        let samples = buffer.get_or_insert_with(|| SampleBuffer::<f32>::new(capacity, spec));
        if samples.capacity() < decoded.frames() * channels {
            *samples = SampleBuffer::<f32>::new(capacity, spec);
        }
        samples.copy_interleaved_ref(decoded);

        let resampler = resampler.get_or_insert_with(|| Resampler::new(spec.rate));
        for frame in samples.samples().chunks_exact(channels) {
            resampler.push(frame.iter().sum::<f32>() / channels as f32);
        }
    }

    let audio = resampler.map(Resampler::finish).unwrap_or_default();
    if audio.is_empty() {
        return Err(DecodeError::new("The file holds no audio"));
    }
    Ok(audio)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A sine of `seconds` at `rate`, in `channels` identical channels, as WAV bytes
    pub fn sine_wav(rate: u32, channels: u16, seconds: f32) -> Vec<u8> {
        let spec = hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut bytes, spec).expect("should start a wav");
            let frames = (rate as f32 * seconds) as usize;
            for n in 0..frames {
                let value = (2.0 * std::f32::consts::PI * 440.0 * n as f32 / rate as f32).sin();
                for _ in 0..channels {
                    writer.write_sample((value * 16000.0) as i16).expect("should write");
                }
            }
            writer.finalize().expect("should finish");
        }
        bytes.into_inner()
    }

    /// A WAV written by hand, so that the header can say what hound would refuse to
    fn raw_wav(rate: u32, channels: u16, bits: u16, declared_data: u32, data: &[u8]) -> Vec<u8> {
        let block = channels * bits / 8;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * block as u32).to_le_bytes());
        out.extend_from_slice(&block.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&declared_data.to_le_bytes());
        out.extend_from_slice(data);
        out
    }

    #[test]
    fn a_wav_with_a_rate_of_zero_is_refused_not_a_panic() {
        let error = decode_to_mono_16k(raw_wav(0, 1, 16, 8, &[0; 8])).unwrap_err();

        assert!(error.to_string().contains("sample rate"), "{}", error);
    }

    #[test]
    fn a_wav_at_1_hz_is_refused() {
        assert!(decode_to_mono_16k(raw_wav(1, 1, 16, 8, &[0; 8])).is_err());
        assert!(decode_to_mono_16k(raw_wav(7_999, 1, 16, 8, &[0; 8])).is_err());
        assert!(decode_to_mono_16k(raw_wav(192_001, 1, 16, 8, &[0; 8])).is_err());
    }

    #[test]
    fn a_wav_with_no_channels_or_too_many_is_refused() {
        let none = decode_to_mono_16k(raw_wav(16_000, 0, 16, 8, &[0; 8])).unwrap_err();
        assert!(none.to_string().contains("channel"), "{}", none);
        assert!(decode_to_mono_16k(raw_wav(16_000, 9, 16, 18, &[0; 18])).is_err());
    }

    #[test]
    fn a_wav_with_a_zero_block_size_is_refused() {
        let mut wav = raw_wav(16_000, 1, 16, 8, &[0; 8]);
        // block align sits 32 bytes in, after RIFF, WAVEfmt, the chunk size and 12 bytes of fields
        wav[32] = 0;
        wav[33] = 0;
        assert!(decode_to_mono_16k(wav).is_err());
    }

    #[test]
    fn eight_channels_at_the_edges_of_the_rate_are_accepted() {
        assert!(decode_to_mono_16k(sine_wav(8_000, 8, 0.1)).is_ok());
        assert!(decode_to_mono_16k(sine_wav(48_000, 1, 0.1)).is_ok());
    }

    #[test]
    fn a_recording_over_thirty_minutes_is_refused_before_it_is_decoded() {
        // 31 minutes of 8 kHz 8-bit silence, about 15 MB
        let data = vec![128u8; 8_000 * 60 * 31];
        let error = decode_to_mono_16k(raw_wav(8_000, 1, 8, data.len() as u32, &data)).unwrap_err();

        assert!(error.too_long);
        assert!(error.to_string().contains("30 minutes"));
    }

    #[test]
    fn the_length_cap_counts_frames_at_the_source_rate() {
        assert!(within_limit(8_000 * MAX_SECONDS, 8_000));
        assert!(!within_limit(8_000 * MAX_SECONDS + 1, 8_000));
        assert!(within_limit(48_000 * MAX_SECONDS, 48_000));
        assert!(!within_limit(48_000 * MAX_SECONDS + 1, 48_000));
    }

    #[test]
    fn a_wav_at_16k_comes_through_unchanged_in_length() {
        let audio = decode_to_mono_16k(sine_wav(16_000, 1, 1.0)).unwrap();

        assert_eq!(audio.len(), 16_000);
        let peak = audio.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.488).abs() < 0.02, "peak was {}", peak);
    }

    #[test]
    fn a_stereo_wav_at_48k_becomes_mono_at_16k() {
        let audio = decode_to_mono_16k(sine_wav(48_000, 2, 1.0)).unwrap();

        assert!((audio.len() as i64 - 16_000).abs() <= 1, "length was {}", audio.len());
        let peak = audio.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.4 && peak < 0.5, "peak was {}", peak);
    }

    #[test]
    fn an_8k_wav_is_brought_up_to_16k() {
        let audio = decode_to_mono_16k(sine_wav(8_000, 1, 0.5)).unwrap();

        assert!((audio.len() as i64 - 8_000).abs() <= 1, "length was {}", audio.len());
    }

    #[test]
    fn a_byte_before_riff_is_refused_not_scanned_past() {
        let mut wav = vec![0u8];
        wav.extend(raw_wav(0, 1, 16, 8, &[0; 8]));

        let error = decode_to_mono_16k(wav).unwrap_err();

        assert_eq!(error.to_string(), UNSUPPORTED_FORMAT);
    }

    #[test]
    fn an_id3_tag_before_riff_is_refused() {
        let mut wav = b"ID3\x03\x00\x00\x00\x00\x00\x00".to_vec();
        wav.extend(sine_wav(16_000, 1, 0.1));

        assert!(decode_to_mono_16k(wav).is_err());
    }

    #[test]
    fn an_mp3_is_refused() {
        let mut mp3 = vec![0xFF, 0xFB, 0x90, 0x64];
        mp3.extend(vec![0u8; 512]);

        assert!(decode_to_mono_16k(mp3).is_err());
    }

    #[test]
    fn an_mp4_with_a_zero_timescale_is_refused_not_a_panic() {
        let mut mp4 = Vec::new();
        mp4.extend_from_slice(&16u32.to_be_bytes());
        mp4.extend_from_slice(b"ftypM4A ");
        mp4.extend_from_slice(&0u32.to_be_bytes());
        // moov > mvhd, version 0, every field including the timescale zero
        mp4.extend_from_slice(&116u32.to_be_bytes());
        mp4.extend_from_slice(b"moov");
        mp4.extend_from_slice(&108u32.to_be_bytes());
        mp4.extend_from_slice(b"mvhd");
        mp4.extend(vec![0u8; 100]);

        assert!(decode_to_mono_16k(mp4).is_err());
    }

    #[test]
    fn an_mkv_header_is_refused() {
        // EBML magic, then a Segment whose Info carries a TimestampScale of 0
        let mut mkv = vec![0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x42, 0x82, 0x81, 0x00];
        mkv.extend_from_slice(&[0x18, 0x53, 0x80, 0x67, 0x88, 0x15, 0x49, 0xA9, 0x66, 0x83, 0x2A, 0xD7, 0xB1]);
        mkv.extend(vec![0u8; 64]);

        assert!(decode_to_mono_16k(mkv).is_err());
    }

    #[test]
    fn something_that_is_not_audio_is_refused() {
        let error = decode_to_mono_16k(b"this is not an audio file at all".to_vec());

        assert!(error.is_err());
    }

    #[test]
    fn an_empty_upload_is_refused() {
        assert!(decode_to_mono_16k(Vec::new()).is_err());
    }

    #[test]
    fn a_wav_with_no_samples_is_refused() {
        assert!(decode_to_mono_16k(sine_wav(16_000, 1, 0.0)).is_err());
    }

    #[test]
    fn the_resampler_averages_what_it_folds() {
        let mut resampler = Resampler::new(48_000);
        for n in 0..6 {
            resampler.push(if n % 2 == 0 { 1.0 } else { -1.0 });
        }
        let out = resampler.finish();

        assert_eq!(out.len(), 2);
        assert!((out[0] - (1.0 / 3.0)).abs() < 1e-6);
        assert!((out[1] + (1.0 / 3.0)).abs() < 1e-6);
    }
}
