//! Where on the desktop the overlay goes.
//!
//! The arithmetic is plain functions over rectangles in physical pixels, which
//! is the one coordinate space every monitor shares. Each monitor carries its
//! own scale, so the window is measured on the monitor it is going to, and a
//! secondary monitor can sit at negative coordinates. What touches Windows is at
//! the bottom of the file and holds no decisions.

use crate::overlay_settings::{FreePosition, OverlayPlacement, ScreenChoice, Spot};
use serde::Serialize;

/// Physical pixels, in the coordinates of the whole desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }

    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    /// How far a point is from the rectangle, zero inside it.
    fn distance(&self, x: i32, y: i32) -> i64 {
        let dx = (self.x - x).max(0).max(x - (self.x + self.w - 1)) as i64;
        let dy = (self.y - y).max(0).max(y - (self.y + self.h - 1)) as i64;
        dx * dx + dy * dy
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Screen {
    /// The name Windows gives it, which is what a chosen screen is remembered by.
    pub id: String,
    pub bounds: Rect,
    /// What is left once the taskbar has taken its share.
    pub work: Rect,
    pub scale: f64,
    pub primary: bool,
}

/// Where the user is, as points on the desktop. Either can be unknown.
#[derive(Debug, Clone, Copy, Default)]
pub struct Whereabouts {
    /// The middle of the window the user is typing in.
    pub typing: Option<(i32, i32)>,
    pub pointer: Option<(i32, i32)>,
}

/// Room kept between a spot and the edge of the work area, in logical pixels.
/// The window already carries some of its own, so this is only a little more.
pub const MARGIN: f64 = 8.0;

fn screen_at(screens: &[Screen], point: Option<(i32, i32)>) -> Option<&Screen> {
    let (x, y) = point?;
    screens.iter().find(|screen| screen.bounds.contains(x, y))
}

/// The screen the overlay goes to, or none when there is no screen at all.
///
/// The default rule is the screen of the window being typed in, then the one
/// with the pointer, then the primary. A chosen screen that is no longer there
/// falls back to that same rule rather than to nothing.
pub fn pick_screen<'a>(
    screens: &'a [Screen],
    choice: ScreenChoice,
    chosen: Option<&str>,
    whereabouts: Whereabouts,
) -> Option<&'a Screen> {
    let primary = || screens.iter().find(|screen| screen.primary).or_else(|| screens.first());
    let typing = || screen_at(screens, whereabouts.typing).or_else(|| screen_at(screens, whereabouts.pointer)).or_else(primary);
    match choice {
        ScreenChoice::Typing => typing(),
        ScreenChoice::Pointer => screen_at(screens, whereabouts.pointer).or_else(primary),
        ScreenChoice::Primary => primary(),
        ScreenChoice::Chosen => chosen
            .and_then(|id| screens.iter().find(|screen| screen.id == id))
            .or_else(typing),
    }
}

/// The window in physical pixels on a screen of this scale.
pub fn window_pixels(logical: (f64, f64), scale: f64) -> (i32, i32) {
    ((logical.0 * scale).round() as i32, (logical.1 * scale).round() as i32)
}

/// The top left corner of the overlay on a screen, always whole inside its work area.
#[cfg(test)]
pub fn position(spot: Spot, free: Option<FreePosition>, screen: &Screen, logical: (f64, f64)) -> (i32, i32) {
    position_keeping(spot, free, screen, logical, MARGIN)
}

/// The same, for a window that keeps a margin of its own from the edges.
pub fn position_keeping(
    spot: Spot,
    free: Option<FreePosition>,
    screen: &Screen,
    logical: (f64, f64),
    margin: f64,
) -> (i32, i32) {
    let work = screen.work;
    // A window larger than the room it has is cut down to it, so the clamp below
    // has something to hold on to.
    let (w, h) = window_pixels(logical, screen.scale);
    let (w, h) = (w.min(work.w), h.min(work.h));
    let margin = (margin * screen.scale).round() as i32;

    let left = work.x + margin;
    let centre = work.x + (work.w - w) / 2;
    let right = work.x + work.w - w - margin;
    let top = work.y + margin;
    let bottom = work.y + work.h - h - margin;

    let (x, y) = match spot {
        Spot::TopLeft => (left, top),
        Spot::TopCenter => (centre, top),
        Spot::TopRight => (right, top),
        Spot::BottomLeft => (left, bottom),
        Spot::BottomCenter => (centre, bottom),
        Spot::BottomRight => (right, bottom),
        Spot::Free => {
            let free = free.unwrap_or_default();
            let share = |value: f64| if value.is_finite() { value.clamp(0.0, 1.0) } else { 0.5 };
            (
                work.x + (share(free.x) * (work.w - w) as f64).round() as i32,
                work.y + (share(free.y) * (work.h - h) as f64).round() as i32,
            )
        }
    };
    (
        x.clamp(work.x, (work.x + work.w - w).max(work.x)),
        y.clamp(work.y, (work.y + work.h - h).max(work.y)),
    )
}

/// Where a window dropped at this corner is, as a share of its screen's room:
/// the screen it mostly sits on, and the position to remember for it.
pub fn free_from_window<'a>(
    corner: (i32, i32),
    window: (i32, i32),
    screens: &'a [Screen],
) -> Option<(&'a Screen, FreePosition)> {
    let middle = (corner.0 + window.0 / 2, corner.1 + window.1 / 2);
    let screen = screens
        .iter()
        .find(|screen| screen.bounds.contains(middle.0, middle.1))
        .or_else(|| screens.iter().min_by_key(|screen| screen.bounds.distance(middle.0, middle.1)))?;
    let work = screen.work;
    let share = |at: i32, start: i32, room: i32| {
        if room <= 0 {
            0.5
        } else {
            (f64::from(at - start) / f64::from(room)).clamp(0.0, 1.0)
        }
    };
    Some((
        screen,
        FreePosition {
            x: share(corner.0, work.x, work.w - window.0),
            y: share(corner.1, work.y, work.h - window.1),
        },
    ))
}

/// An overlay position an earlier build saved, in physical pixels of the
/// desktop, as a free position on whichever screen holds it.
pub fn free_from_saved_corner<'a>(
    corner: (f64, f64),
    logical: (f64, f64),
    screens: &'a [Screen],
) -> Option<(&'a Screen, FreePosition)> {
    let corner = (corner.0.round() as i32, corner.1.round() as i32);
    let scale = screens
        .iter()
        .find(|screen| screen.bounds.contains(corner.0, corner.1))
        .map_or(1.0, |screen| screen.scale);
    free_from_window(corner, window_pixels(logical, scale), screens)
}

/// An overlay position an earlier build saved becomes a free position as a share of the screen
/// that holds it. Nothing happens to a placement that is not waiting for one.
pub fn adopt_saved_corner(
    placement: &mut OverlayPlacement,
    saved: (f64, f64),
    logical: (f64, f64),
    screens: &[Screen],
) -> bool {
    if placement.spot != Spot::Free || placement.free.is_some() {
        return false;
    }
    let Some((screen, free)) = free_from_saved_corner(saved, logical, screens) else { return false };
    placement.free = Some(free);
    follow(placement, screen);
    true
}

/// A position dropped on a screen the user picked by hand moves that pick along with it. Any
/// other rule is left alone: the share applies on whichever screen the rule names next time.
fn follow(placement: &mut OverlayPlacement, screen: &Screen) {
    if placement.screen == ScreenChoice::Chosen {
        placement.chosen_screen = Some(screen.id.clone());
    }
}

/// The screen and the corner the overlay is shown at: the screen the rule picks, and a free
/// position as a share of that screen's room.
pub fn target<'a>(
    placement: &OverlayPlacement,
    screens: &'a [Screen],
    whereabouts: Whereabouts,
    logical: (f64, f64),
    margin: f64,
) -> Option<(&'a Screen, (i32, i32))> {
    let screen = pick_screen(screens, placement.screen, placement.chosen_screen.as_deref(), whereabouts)?;
    Some((screen, position_keeping(placement.spot, placement.free, screen, logical, margin)))
}

/// What is to be done about a move the window reported. The corner `place` put the window at
/// is not a drag, and once a drag is taken in, the next one is judged afresh.
pub fn dropped(
    placement: &mut OverlayPlacement,
    placed: &mut Option<(i32, i32)>,
    corner: (i32, i32),
    window: (i32, i32),
    screens: &[Screen],
) -> bool {
    if placed.is_some_and(|at| (at.0 - corner.0).abs() <= 1 && (at.1 - corner.1).abs() <= 1) {
        return false;
    }
    let Some((screen, free)) = free_from_window(corner, window, screens) else { return false };
    placement.spot = Spot::Free;
    placement.free = Some(free);
    follow(placement, screen);
    *placed = None;
    true
}

/// The middle of the window the user is typing in, or nothing when that says nothing about
/// where the user is: no window, or the desktop itself, whose window spans every screen and
/// whose middle can be on the wrong one or in a gap.
pub fn typing_point(window: Option<Rect>, screens: &[Screen]) -> Option<(i32, i32)> {
    let window = window?;
    if screens.len() > 1 {
        let left = screens.iter().map(|s| s.bounds.x).min()?;
        let top = screens.iter().map(|s| s.bounds.y).min()?;
        let right = screens.iter().map(|s| s.bounds.x + s.bounds.w).max()?;
        let bottom = screens.iter().map(|s| s.bounds.y + s.bounds.h).max()?;
        if window.x <= left && window.y <= top && window.x + window.w >= right && window.y + window.h >= bottom {
            return None;
        }
    }
    Some((window.x + window.w / 2, window.y + window.h / 2))
}

/// A screen as the selector names it.
#[derive(Debug, Clone, Serialize)]
pub struct ScreenView {
    /// What a chosen screen is remembered by.
    pub id: String,
    pub width: i32,
    pub height: i32,
    pub primary: bool,
}

impl From<&Screen> for ScreenView {
    fn from(screen: &Screen) -> Self {
        Self { id: screen.id.clone(), width: screen.bounds.w, height: screen.bounds.h, primary: screen.primary }
    }
}

/// The window the user is typing in, as a rectangle: not the desktop, not the overlay, and
/// nothing while no window has the focus.
#[cfg(windows)]
pub fn typing_window(overlay: Option<isize>) -> Option<Rect> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, IsIconic};

    unsafe {
        let window = GetForegroundWindow();
        // No window has the focus on the desktop between two applications, and a
        // minimized one reports a rectangle far off every screen.
        if window.is_invalid() || overlay == Some(window.0 as isize) || IsIconic(window).as_bool() {
            return None;
        }
        let mut name = [0u16; 64];
        let length = GetClassNameW(window, &mut name).max(0) as usize;
        let class = String::from_utf16_lossy(&name[..length]);
        if class == "Progman" || class == "WorkerW" {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect).ok()?;
        Some(Rect::new(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
    }
}

#[cfg(not(windows))]
pub fn typing_window(_overlay: Option<isize>) -> Option<Rect> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGICAL: (f64, f64) = (244.0, 92.0);

    fn screen(id: &str, x: i32, y: i32, w: i32, h: i32, taskbar: i32, scale: f64, primary: bool) -> Screen {
        Screen {
            id: id.to_string(),
            bounds: Rect::new(x, y, w, h),
            work: Rect::new(x, y, w, h - taskbar),
            scale,
            primary,
        }
    }

    /// A laptop at 125 percent with a 4K panel to its left at 200, and a 1080p
    /// one above-left of it at negative coordinates on both axes.
    fn desk() -> Vec<Screen> {
        vec![
            screen("laptop", 0, 0, 1920, 1080, 60, 1.25, true),
            screen("panel", -3840, -400, 3840, 2160, 80, 2.0, false),
            screen("tv", -1920, -1480, 1920, 1080, 48, 1.0, false),
        ]
    }

    fn inside(work: Rect, corner: (i32, i32), window: (i32, i32)) -> bool {
        corner.0 >= work.x
            && corner.1 >= work.y
            && corner.0 + window.0 <= work.x + work.w
            && corner.1 + window.1 <= work.y + work.h
    }

    #[test]
    fn the_window_is_measured_on_the_screen_it_goes_to() {
        for (scale, wide, high) in [(1.0, 244, 92), (1.25, 305, 115), (1.5, 366, 138), (2.0, 488, 184)] {
            assert_eq!(window_pixels(LOGICAL, scale), (wide, high), "scale {scale}");
        }
    }

    #[test]
    fn bottom_centre_sits_above_the_taskbar_at_every_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let screen = screen("main", 0, 0, 1920, 1080, 48, scale, true);
            let (w, h) = window_pixels(LOGICAL, scale);
            let (x, y) = position(Spot::BottomCenter, None, &screen, LOGICAL);
            let margin = (8.0 * scale).round() as i32;

            assert_eq!(x, (1920 - w) / 2, "scale {scale}");
            assert_eq!(y, 1080 - 48 - h - margin, "scale {scale}");
            assert!(inside(screen.work, (x, y), (w, h)), "scale {scale}");
        }
    }

    #[test]
    fn the_six_spots_land_where_they_are_named() {
        let screen = screen("main", 0, 0, 1920, 1080, 48, 1.5, true);
        let (w, h) = window_pixels(LOGICAL, 1.5);
        let margin = 12;
        let at = |spot| position(spot, None, &screen, LOGICAL);

        assert_eq!(at(Spot::TopLeft), (margin, margin));
        assert_eq!(at(Spot::TopCenter), ((1920 - w) / 2, margin));
        assert_eq!(at(Spot::TopRight), (1920 - w - margin, margin));
        assert_eq!(at(Spot::BottomLeft), (margin, 1032 - h - margin));
        assert_eq!(at(Spot::BottomCenter), ((1920 - w) / 2, 1032 - h - margin));
        assert_eq!(at(Spot::BottomRight), (1920 - w - margin, 1032 - h - margin));
    }

    #[test]
    fn a_secondary_screen_at_negative_coordinates_places_in_its_own_corner() {
        let desk = desk();
        let panel = &desk[1];
        let (w, h) = window_pixels(LOGICAL, 2.0);

        let (x, y) = position(Spot::TopLeft, None, panel, LOGICAL);
        assert_eq!((x, y), (-3840 + 16, -400 + 16));

        let (x, y) = position(Spot::BottomRight, None, panel, LOGICAL);
        assert_eq!(x, -3840 + 3840 - w - 16);
        assert_eq!(y, -400 + 2160 - 80 - h - 16);

        let tv = &desk[2];
        let (x, y) = position(Spot::BottomCenter, None, tv, LOGICAL);
        assert_eq!(x, -1920 + (1920 - 244) / 2);
        assert_eq!(y, -1480 + 1080 - 48 - 92 - 8);
        assert!(inside(tv.work, (x, y), (244, 92)));
    }

    #[test]
    fn every_spot_stays_whole_inside_every_screen_of_the_desk() {
        for screen in desk() {
            let window = window_pixels(LOGICAL, screen.scale);
            for spot in [
                Spot::TopLeft,
                Spot::TopCenter,
                Spot::TopRight,
                Spot::BottomLeft,
                Spot::BottomCenter,
                Spot::BottomRight,
            ] {
                let corner = position(spot, None, &screen, LOGICAL);
                assert!(inside(screen.work, corner, window), "{} {:?}", screen.id, spot);
            }
        }
    }

    #[test]
    fn a_free_position_is_a_share_of_the_work_area() {
        let screen = screen("main", 0, 0, 2000, 1000, 40, 1.0, true);
        let (w, h) = window_pixels(LOGICAL, 1.0);
        let free = |x, y| position(Spot::Free, Some(FreePosition { x, y }), &screen, LOGICAL);

        assert_eq!(free(0.0, 0.0), (0, 0));
        assert_eq!(free(1.0, 1.0), (2000 - w, 960 - h));
        assert_eq!(free(0.5, 0.5), (((2000 - w) as f64 * 0.5).round() as i32, ((960 - h) as f64 * 0.5).round() as i32));
    }

    #[test]
    fn a_free_position_survives_a_change_of_resolution_and_scale() {
        // The same share on the same panel after Windows moved it from 4K at
        // 200 percent to 1080p at 100: still whole on the screen, still on the
        // same side of it.
        let free = Some(FreePosition { x: 0.9, y: 0.1 });
        for (w, h, scale) in [(3840, 2160, 2.0), (2560, 1440, 1.5), (1920, 1080, 1.0), (1280, 720, 1.0)] {
            let screen = screen("main", 0, 0, w, h, 48, scale, true);
            let window = window_pixels(LOGICAL, scale);
            let corner = position(Spot::Free, free, &screen, LOGICAL);
            assert!(inside(screen.work, corner, window), "{w}x{h} at {scale}");
            assert!(corner.0 > w / 2, "{w}x{h} still on the right");
            assert!(corner.1 < h / 3, "{w}x{h} still near the top");
        }
    }

    #[test]
    fn a_free_position_out_of_range_is_held_on_the_screen() {
        let screen = screen("main", 0, 0, 1920, 1080, 48, 1.0, true);
        let window = window_pixels(LOGICAL, 1.0);
        for (x, y) in [(-4.0, 9.0), (7.0, -1.0), (f64::NAN, f64::INFINITY)] {
            let corner = position(Spot::Free, Some(FreePosition { x, y }), &screen, LOGICAL);
            assert!(inside(screen.work, corner, window), "{x} {y}");
        }
    }

    #[test]
    fn a_window_larger_than_the_work_area_is_still_pulled_onto_it() {
        let tiny = screen("tiny", 100, 50, 200, 80, 0, 1.0, true);
        let (x, y) = position(Spot::BottomRight, None, &tiny, LOGICAL);
        assert_eq!((x, y), (100, 50));
    }

    #[test]
    fn dropping_the_window_gives_back_the_same_place() {
        let all = desk();
        for screen in all.clone() {
            let window = window_pixels(LOGICAL, screen.scale);
            for (x, y) in [(0.0, 0.0), (1.0, 1.0), (0.37, 0.81), (0.5, 1.0)] {
                let free = FreePosition { x, y };
                let corner = position(Spot::Free, Some(free), &screen, LOGICAL);
                let (found, back) = free_from_window(corner, window, &all).expect("a screen");
                assert_eq!(found.id, screen.id);
                // One pixel of rounding on a travel of a thousand or more.
                assert!((back.x - x).abs() < 0.002 && (back.y - y).abs() < 0.002, "{} {x} {y} came back {back:?}", screen.id);
                assert_eq!(position(Spot::Free, Some(back), found, LOGICAL), corner, "{} {x} {y}", screen.id);
            }
        }
    }

    #[test]
    fn a_window_dropped_across_two_screens_belongs_to_the_one_holding_its_middle() {
        let desk = desk();
        let window = window_pixels(LOGICAL, 1.25);
        // Its middle is 10 pixels inside the laptop, the rest hangs over the panel.
        let (found, _) = free_from_window((10 - window.0 / 2, 500), window, &desk).expect("a screen");
        assert_eq!(found.id, "laptop");
        let (found, _) = free_from_window((-10 - window.0 / 2, 500), window, &desk).expect("a screen");
        assert_eq!(found.id, "panel");
    }

    #[test]
    fn a_window_dropped_in_a_gap_goes_to_the_nearest_screen() {
        // Above the laptop and right of the tv, which ends at x 0: no screen
        // holds this point, and the laptop is the closest.
        let desk = desk();
        let (found, free) = free_from_window((900, -300), (244, 92), &desk).expect("a screen");
        assert_eq!(found.id, "laptop");
        assert_eq!(free.y, 0.0);
    }

    #[test]
    fn the_default_rule_follows_the_window_being_typed_in() {
        let desk = desk();
        let at = |typing, pointer| {
            pick_screen(&desk, ScreenChoice::Typing, None, Whereabouts { typing, pointer }).map(|s| s.id.as_str())
        };
        assert_eq!(at(Some((-500, 300)), Some((100, 100))), Some("panel"));
        assert_eq!(at(Some((100, 100)), Some((-500, 300))), Some("laptop"));
        assert_eq!(at(Some((-900, -1000)), None), Some("tv"));
    }

    #[test]
    fn with_nobody_typing_the_pointer_is_followed_and_then_the_primary() {
        let desk = desk();
        let at = |typing, pointer| {
            pick_screen(&desk, ScreenChoice::Typing, None, Whereabouts { typing, pointer }).map(|s| s.id.as_str())
        };
        assert_eq!(at(None, Some((-500, 300))), Some("panel"));
        assert_eq!(at(None, None), Some("laptop"));
        assert_eq!(at(Some((90000, 90000)), None), Some("laptop"));
    }

    #[test]
    fn the_pointer_choice_ignores_where_the_user_types() {
        let desk = desk();
        let whereabouts = Whereabouts { typing: Some((100, 100)), pointer: Some((-500, 300)) };
        assert_eq!(pick_screen(&desk, ScreenChoice::Pointer, None, whereabouts).map(|s| s.id.as_str()), Some("panel"));
        let lost = Whereabouts { typing: Some((-500, 300)), pointer: None };
        assert_eq!(pick_screen(&desk, ScreenChoice::Pointer, None, lost).map(|s| s.id.as_str()), Some("laptop"));
    }

    #[test]
    fn the_primary_choice_is_always_the_primary() {
        let desk = desk();
        let whereabouts = Whereabouts { typing: Some((-500, 300)), pointer: Some((-500, 300)) };
        assert_eq!(pick_screen(&desk, ScreenChoice::Primary, None, whereabouts).map(|s| s.id.as_str()), Some("laptop"));
    }

    #[test]
    fn a_chosen_screen_is_the_only_one_and_a_missing_one_falls_back_to_the_default_rule() {
        let desk = desk();
        let whereabouts = Whereabouts { typing: Some((-500, 300)), pointer: Some((100, 100)) };
        let pick = |id: Option<&str>| pick_screen(&desk, ScreenChoice::Chosen, id, whereabouts).map(|s| s.id.as_str());
        assert_eq!(pick(Some("tv")), Some("tv"));
        assert_eq!(pick(Some("laptop")), Some("laptop"));
        assert_eq!(pick(Some("unplugged")), Some("panel"), "the screen being typed on");
        assert_eq!(pick(None), Some("panel"));
    }

    #[test]
    fn no_screen_at_all_places_nothing() {
        assert!(pick_screen(&[], ScreenChoice::Typing, None, Whereabouts::default()).is_none());
        assert!(free_from_window((0, 0), (10, 10), &[]).is_none());
        assert!(target(&OverlayPlacement::default(), &[], Whereabouts::default(), LOGICAL, MARGIN).is_none());
    }

    fn free_at(x: f64, y: f64) -> OverlayPlacement {
        OverlayPlacement { spot: Spot::Free, free: Some(FreePosition { x, y }), ..Default::default() }
    }

    fn typing_on_the_laptop() -> Whereabouts {
        Whereabouts { typing: Some((100, 100)), pointer: Some((100, 100)) }
    }

    #[test]
    fn a_free_position_is_a_share_of_whichever_screen_the_rule_picks() {
        let desk = desk();
        let placement = free_at(0.25, 1.0);
        let (screen, corner) = target(&placement, &desk, typing_on_the_laptop(), LOGICAL, MARGIN).expect("a screen");
        assert_eq!(screen.id, "laptop");
        let (w, _) = window_pixels(LOGICAL, 1.25);
        assert_eq!(corner.0, ((1920 - w) as f64 * 0.25).round() as i32);

        let on_the_panel = Whereabouts { typing: Some((-500, 300)), pointer: Some((100, 100)) };
        let (screen, corner) = target(&placement, &desk, on_the_panel, LOGICAL, MARGIN).expect("a screen");
        assert_eq!(screen.id, "panel", "the rule still decides the screen");
        assert!(inside(screen.work, corner, window_pixels(LOGICAL, 2.0)));
    }

    #[test]
    fn the_fixed_screen_rule_still_applies_to_a_spot() {
        let desk = desk();
        let placement = OverlayPlacement {
            screen: ScreenChoice::Chosen,
            chosen_screen: Some("tv".to_string()),
            ..Default::default()
        };
        let (screen, corner) = target(&placement, &desk, typing_on_the_laptop(), LOGICAL, MARGIN).expect("a screen");
        assert_eq!(screen.id, "tv");
        assert!(inside(screen.work, corner, window_pixels(LOGICAL, 1.0)));
    }

    #[test]
    fn a_position_an_earlier_build_saved_is_adopted_on_the_screen_that_holds_it() {
        let desk = desk();
        // Left on the 4K panel by the release before, in desktop pixels.
        let mut placement = OverlayPlacement { spot: Spot::Free, ..Default::default() };
        assert!(adopt_saved_corner(&mut placement, (-1000.0, 300.0), LOGICAL, &desk));
        assert_eq!(placement.chosen_screen, None, "the screen rule is left alone");

        let on_the_panel = Whereabouts { typing: Some((-500, 300)), pointer: None };
        let (screen, corner) = target(&placement, &desk, on_the_panel, LOGICAL, MARGIN).expect("a screen");
        assert_eq!(screen.id, "panel");
        assert!((corner.0 + 1000).abs() <= 1 && (corner.1 - 300).abs() <= 1, "and lands where it was left: {corner:?}");

        let mut chosen = OverlayPlacement { spot: Spot::Free, screen: ScreenChoice::Chosen, ..Default::default() };
        assert!(adopt_saved_corner(&mut chosen, (-1000.0, 300.0), LOGICAL, &desk));
        assert_eq!(chosen.chosen_screen.as_deref(), Some("panel"));
    }

    #[test]
    fn a_position_is_only_adopted_once_and_only_when_it_is_waiting() {
        let desk = desk();
        let mut pinned = OverlayPlacement::default();
        assert!(!adopt_saved_corner(&mut pinned, (10.0, 10.0), LOGICAL, &desk));
        let mut done = free_at(0.5, 0.5);
        assert!(!adopt_saved_corner(&mut done, (10.0, 10.0), LOGICAL, &desk));
        assert_eq!(done, free_at(0.5, 0.5));
        assert!(!adopt_saved_corner(&mut OverlayPlacement { spot: Spot::Free, ..Default::default() }, (0.0, 0.0), LOGICAL, &[]));
    }

    #[test]
    fn a_move_to_the_corner_just_placed_is_not_a_drag() {
        let desk = desk();
        let mut placement = OverlayPlacement::default();
        let corner = position(Spot::BottomCenter, None, &desk[0], LOGICAL);
        let mut placed = Some(corner);
        let window = window_pixels(LOGICAL, 1.25);

        assert!(!dropped(&mut placement, &mut placed, corner, window, &desk));
        assert!(!dropped(&mut placement, &mut placed, (corner.0 + 1, corner.1 - 1), window, &desk), "a pixel of rounding");
        assert_eq!(placement, OverlayPlacement::default());
        assert_eq!(placed, Some(corner), "nothing was taken in");
    }

    #[test]
    fn a_drag_is_taken_in_and_the_next_one_is_judged_afresh() {
        let desk = desk();
        let mut placement = OverlayPlacement::default();
        let corner = position(Spot::BottomCenter, None, &desk[0], LOGICAL);
        let mut placed = Some(corner);
        let window = window_pixels(LOGICAL, 2.0);

        assert!(dropped(&mut placement, &mut placed, (-2000, 400), window, &desk));
        assert_eq!(placement.spot, Spot::Free);
        assert!(placement.free.is_some());
        assert_eq!(placement.screen, ScreenChoice::Typing, "the rule is untouched");
        assert_eq!(placement.chosen_screen, None);
        assert_eq!(placed, None);

        // Dragged back to within a pixel of where the overlay was first placed: it counts.
        let back = (corner.0 + 1, corner.1);
        assert!(dropped(&mut placement, &mut placed, back, window_pixels(LOGICAL, 1.25), &desk));
        assert!(placement.free.is_some());
    }

    #[test]
    fn a_drop_on_another_screen_moves_a_chosen_screen_and_no_other_rule() {
        let desk = desk();
        let window = window_pixels(LOGICAL, 2.0);
        for rule in [ScreenChoice::Typing, ScreenChoice::Pointer, ScreenChoice::Primary] {
            let mut placement = OverlayPlacement { screen: rule, ..Default::default() };
            assert!(dropped(&mut placement, &mut None, (-2000, 400), window, &desk));
            assert_eq!(placement.screen, rule);
            assert_eq!(placement.chosen_screen, None);
        }
        let mut placement = OverlayPlacement {
            screen: ScreenChoice::Chosen,
            chosen_screen: Some("laptop".to_string()),
            ..Default::default()
        };
        assert!(dropped(&mut placement, &mut None, (-2000, 400), window, &desk));
        assert_eq!(placement.screen, ScreenChoice::Chosen);
        assert_eq!(placement.chosen_screen.as_deref(), Some("panel"));
    }

    #[test]
    fn a_move_with_no_screen_to_hold_it_is_not_a_drag() {
        let mut placement = OverlayPlacement::default();
        assert!(!dropped(&mut placement, &mut None, (0, 0), (10, 10), &[]));
        assert_eq!(placement, OverlayPlacement::default());
    }

    #[test]
    fn the_desktop_in_front_says_nothing_about_where_the_user_is() {
        let desk = desk();
        // The desktop window spans every screen: its middle is on one of them by chance.
        let whole = Rect::new(-3840, -1480, 5760, 3240);
        assert_eq!(typing_point(Some(whole), &desk), None);
        assert_eq!(typing_point(None, &desk), None);
        // A window on one screen, or one larger than a screen but not the whole desktop, still counts.
        assert_eq!(typing_point(Some(Rect::new(100, 100, 800, 600)), &desk), Some((500, 400)));
        assert_eq!(typing_point(Some(Rect::new(-3840, -400, 3840, 2160)), &desk), Some((-1920, 680)));
    }

    #[test]
    fn with_one_screen_a_window_covering_it_is_the_window_being_typed_in() {
        let one = vec![screen("only", 0, 0, 1920, 1080, 48, 1.0, true)];
        assert_eq!(typing_point(Some(Rect::new(0, 0, 1920, 1080)), &one), Some((960, 540)));
    }

    #[test]
    fn nobody_typing_means_the_pointer_decides_through_the_whole_path() {
        let desk = desk();
        let whereabouts = Whereabouts {
            typing: typing_point(Some(Rect::new(-3840, -1480, 5760, 3240)), &desk),
            pointer: Some((-500, 300)),
        };
        let (screen, _) = target(&OverlayPlacement::default(), &desk, whereabouts, LOGICAL, MARGIN).expect("a screen");
        assert_eq!(screen.id, "panel");
    }
}
