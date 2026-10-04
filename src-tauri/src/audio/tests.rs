use super::*;

/// A tone of a known amplitude, so RMS is something the test can predict.
fn sine(amplitude: f32, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| amplitude * (i as f32 * 0.1).sin())
        .collect()
}

#[test]
fn a_new_buffer_is_silent_rather_than_undefined() {
    let buffer = AudioBuffer::new();
    assert!(buffer.take().is_empty());
    // The overlay draws one bar per entry, so the length has to hold even with
    // nothing recorded yet.
    assert_eq!(buffer.get_spectrum(12), vec![0.0; 12]);
}

#[test]
fn take_empties_the_buffer() {
    let buffer = AudioBuffer::new();
    buffer.push(&[0.1, 0.2, 0.3]);

    assert_eq!(buffer.take(), vec![0.1, 0.2, 0.3]);
    assert!(buffer.take().is_empty(), "a second take must not repeat the audio");
}

#[test]
fn pushes_accumulate_in_order() {
    let buffer = AudioBuffer::new();
    buffer.push(&[0.1, 0.2]);
    buffer.push(&[0.3]);

    assert_eq!(buffer.take(), vec![0.1, 0.2, 0.3]);
}

#[test]
fn the_spectrum_returns_one_value_per_bar_and_stays_in_range() {
    let buffer = AudioBuffer::new();
    buffer.push(&sine(0.3, 3200));

    for bars in [1, 5, 12, 64] {
        let levels = buffer.get_spectrum(bars);
        assert_eq!(levels.len(), bars, "asked for {} bars", bars);
        for level in levels {
            assert!((0.0..=1.0).contains(&level), "{} is outside the drawable range", level);
        }
    }
}

#[test]
fn asking_for_no_bars_gives_no_bars() {
    let buffer = AudioBuffer::new();
    buffer.push(&sine(0.3, 1000));

    assert!(buffer.get_spectrum(0).is_empty());
}

#[test]
fn the_spectrum_survives_more_bars_than_samples() {
    // Right at the start of a recording there are only a handful of samples and
    // the overlay still asks for its full set of bars.
    let buffer = AudioBuffer::new();
    buffer.push(&[0.1, 0.2, 0.3]);

    let levels = buffer.get_spectrum(32);
    assert_eq!(levels.len(), 32);
    assert!(levels.iter().all(|l| l.is_finite()));
}

#[test]
fn a_loud_passage_reads_as_full_scale_rather_than_overflowing() {
    let buffer = AudioBuffer::new();
    buffer.push(&vec![1.0; 3200]);

    assert!(buffer.get_spectrum(8).iter().all(|&l| l == 1.0));
}

#[test]
fn the_buffer_drops_its_oldest_audio_instead_of_growing_without_end() {
    // Ten minutes is the cap. Past it the oldest samples go, so a recording left
    // running does not eat memory until the process dies.
    let buffer = AudioBuffer::new();
    let marker = 0.42;
    buffer.push(&[marker]);
    buffer.push(&vec![0.0; MAX_BUFFER_SAMPLES]);

    let data = buffer.take();
    assert_eq!(data.len(), MAX_BUFFER_SAMPLES);
    assert_ne!(data[0], marker, "the oldest sample should have been dropped");
}

#[test]
fn a_recording_exactly_at_the_cap_loses_nothing() {
    let buffer = AudioBuffer::new();
    let marker = 0.42;
    buffer.push(&[marker]);
    buffer.push(&vec![0.0; MAX_BUFFER_SAMPLES - 1]);

    let data = buffer.take();
    assert_eq!(data.len(), MAX_BUFFER_SAMPLES);
    assert_eq!(data[0], marker);
}

#[test]
fn past_the_cap_the_newest_audio_stays_in_order() {
    let buffer = AudioBuffer::new();
    buffer.push(&vec![0.0; MAX_BUFFER_SAMPLES - 2]);
    buffer.push(&[0.1, 0.2, 0.3, 0.4]);

    let data = buffer.take();
    assert_eq!(data.len(), MAX_BUFFER_SAMPLES);
    assert_eq!(&data[MAX_BUFFER_SAMPLES - 4..], &[0.1, 0.2, 0.3, 0.4]);
}

#[test]
fn audio_pushed_after_a_take_starts_a_fresh_buffer() {
    let buffer = AudioBuffer::new();
    buffer.push(&vec![0.0; MAX_BUFFER_SAMPLES]);
    buffer.push(&[0.1, 0.2]);
    assert_eq!(buffer.take().len(), MAX_BUFFER_SAMPLES);

    buffer.push(&[0.3]);

    assert_eq!(buffer.take(), vec![0.3]);
}

#[test]
fn one_push_larger_than_the_cap_keeps_its_own_end() {
    let buffer = AudioBuffer::new();
    buffer.push(&[0.9]);
    let mut big = vec![0.0; MAX_BUFFER_SAMPLES + 3];
    big[MAX_BUFFER_SAMPLES + 2] = 0.7;
    buffer.push(&big);

    let data = buffer.take();
    assert_eq!(data.len(), MAX_BUFFER_SAMPLES);
    assert_eq!(data[MAX_BUFFER_SAMPLES - 1], 0.7);
    assert!(!data.contains(&0.9));
}

#[test]
fn the_buffer_is_shared_and_not_copied_when_cloned() {
    // Clones are handed to the capture callback and to the overlay, and both
    // have to see the same audio.
    let buffer = AudioBuffer::new();
    let other = buffer.clone();

    other.push(&[0.1, 0.2]);

    assert_eq!(buffer.take(), vec![0.1, 0.2]);
}

#[test]
fn stopping_a_capture_handle_is_visible_to_its_clones() {
    let handle = AudioCaptureHandle {
        stop_signal: Arc::new(AtomicBool::new(false)),
    };
    let clone = handle.clone();

    handle.stop();

    assert!(clone.stop_signal.load(Ordering::SeqCst));
}
