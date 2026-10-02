use serde::Serialize;

pub const ALLOWED_RESPONSE_FORMATS: [&str; 5] = ["json", "text", "verbose_json", "srt", "vtt"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Segment {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transcription {
    pub text: String,
    pub language: String,
    pub duration: f64,
    pub segments: Vec<Segment>,
}

/// `hh:mm:ss` and the milliseconds after `separator`, cut rather than rounded
/// as the reference server does, so the two never disagree by a millisecond.
fn timestamp(seconds: f64, separator: char) -> String {
    let hours = (seconds / 3600.0).floor() as u64;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u64;
    let secs = (seconds % 60.0).floor() as u64;
    let millis = ((seconds % 1.0) * 1000.0).floor() as u64;
    format!("{:02}:{:02}:{:02}{}{:03}", hours, minutes, secs, separator, millis)
}

pub fn format_srt(segments: &[Segment]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for segment in segments {
        lines.push((segment.index + 1).to_string());
        lines.push(format!(
            "{} --> {}",
            timestamp(segment.start, ','),
            timestamp(segment.end, ',')
        ));
        lines.push(segment.text.trim().to_string());
        lines.push(String::new());
    }
    lines.join("\n")
}

pub fn format_vtt(segments: &[Segment]) -> String {
    let mut lines: Vec<String> = vec!["WEBVTT".to_string(), String::new()];
    for segment in segments {
        lines.push(format!(
            "{} --> {}",
            timestamp(segment.start, '.'),
            timestamp(segment.end, '.')
        ));
        lines.push(segment.text.trim().to_string());
        lines.push(String::new());
    }
    lines.join("\n")
}

#[derive(Serialize)]
struct Plain<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct Verbose<'a> {
    task: &'static str,
    language: &'a str,
    duration: f64,
    text: &'a str,
    segments: &'a [Segment],
}

#[derive(Serialize)]
struct Done<'a> {
    text: &'a str,
    language: &'a str,
    duration: f64,
}

#[derive(Serialize)]
struct Failure<'a> {
    message: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
}

fn to_json(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

pub fn json_body(result: &Transcription) -> String {
    to_json(&Plain { text: &result.text })
}

pub fn verbose_json_body(result: &Transcription) -> String {
    to_json(&Verbose {
        task: "transcribe",
        language: &result.language,
        duration: result.duration,
        text: &result.text,
        segments: &result.segments,
    })
}

/// One server-sent event, framed the way the reference server frames it
fn sse_event(name: &str, data: &impl Serialize) -> String {
    format!("event: {}\ndata: {}\n\n", name, to_json(data))
}

pub fn segment_event(segment: &Segment) -> String {
    sse_event("segment", segment)
}

pub fn done_event(result: &Transcription) -> String {
    sse_event(
        "done",
        &Done {
            text: &result.text,
            language: &result.language,
            duration: result.duration,
        },
    )
}

pub fn error_event(message: &str, kind: &str) -> String {
    sse_event("error", &Failure { message, kind })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn sample() -> Transcription {
        Transcription {
            text: "Bonjour le monde".to_string(),
            language: "fr".to_string(),
            duration: 5.1,
            segments: vec![
                Segment { index: 0, start: 0.0, end: 2.5, text: " Bonjour".to_string() },
                Segment { index: 1, start: 2.5, end: 3725.25, text: " le monde".to_string() },
            ],
        }
    }

    #[test]
    fn srt_numbers_from_one_and_uses_commas() {
        let srt = format_srt(&sample().segments);

        assert_eq!(
            srt,
            "1\n00:00:00,000 --> 00:00:02,500\nBonjour\n\n2\n00:00:02,500 --> 01:02:05,250\nle monde\n"
        );
    }

    #[test]
    fn vtt_opens_with_its_header_and_uses_dots() {
        let vtt = format_vtt(&sample().segments);

        assert_eq!(
            vtt,
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nBonjour\n\n00:00:02.500 --> 01:02:05.250\nle monde\n"
        );
    }

    #[test]
    fn subtitles_of_nothing_are_what_the_reference_prints() {
        assert_eq!(format_srt(&[]), "");
        assert_eq!(format_vtt(&[]), "WEBVTT\n");
    }

    #[test]
    fn json_carries_only_the_text() {
        assert_eq!(json_body(&sample()), "{\"text\":\"Bonjour le monde\"}");
    }

    #[test]
    fn verbose_json_carries_the_segments_untrimmed() {
        let body: serde_json::Value = serde_json::from_str(&verbose_json_body(&sample())).unwrap();

        assert_eq!(body["task"], "transcribe");
        assert_eq!(body["language"], "fr");
        assert_eq!(body["duration"], 5.1);
        assert_eq!(body["segments"][0]["index"], 0);
        assert_eq!(body["segments"][1]["text"], " le monde");
        assert_eq!(body["segments"][1]["end"], 3725.25);
    }

    #[test]
    fn events_are_framed_as_the_server_frames_them() {
        let result = sample();

        assert_eq!(
            segment_event(&result.segments[0]),
            "event: segment\ndata: {\"index\":0,\"start\":0.0,\"end\":2.5,\"text\":\" Bonjour\"}\n\n"
        );
        assert_eq!(
            done_event(&result),
            "event: done\ndata: {\"text\":\"Bonjour le monde\",\"language\":\"fr\",\"duration\":5.1}\n\n"
        );
        assert_eq!(
            error_event("boom", "TranscriptionError"),
            "event: error\ndata: {\"message\":\"boom\",\"type\":\"TranscriptionError\"}\n\n"
        );
    }
}
