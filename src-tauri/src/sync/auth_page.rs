//! The page the browser lands on after Google sign-in, served from the
//! loopback listener. Self-contained: inline CSS, the typeface as data URIs,
//! no script and no outside fetch.

use base64::Engine;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Page {
    Done,
    Refused,
    Unexpected,
}

/// French when the request's Accept-Language starts with it, English otherwise.
pub fn prefers_french(request: &str) -> bool {
    request
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("accept-language"))
        .map(|(_, value)| value.trim().to_ascii_lowercase().starts_with("fr"))
        .unwrap_or(false)
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

struct Texts {
    title: &'static str,
    message: &'static str,
}

fn texts(page: Page, french: bool) -> Texts {
    let (title, message) = match (page, french) {
        (Page::Done, false) => ("You are signed in", "You can close this tab and go back to Talk."),
        (Page::Done, true) => ("Connexion réussie", "Vous pouvez fermer cet onglet et retourner dans Talk."),
        (Page::Refused, false) => (
            "Sign-in was refused",
            "Google did not allow the sign-in. Go back to Talk and try again.",
        ),
        (Page::Refused, true) => (
            "Connexion refusée",
            "Google n'a pas autorisé la connexion. Retournez dans Talk et réessayez.",
        ),
        (Page::Unexpected, false) => (
            "Something went wrong",
            "This sign-in answer was not expected. Go back to Talk and try again.",
        ),
        (Page::Unexpected, true) => (
            "Une erreur est survenue",
            "Cette réponse de connexion n'était pas attendue. Retournez dans Talk et réessayez.",
        ),
    };
    Texts { title, message }
}

const MARK_OK: &str = "<path d=\"M6 12.5l4 4 8-9\"/>";
const MARK_FAIL: &str = "<path d=\"M7 7l10 10M17 7L7 17\"/>";

/// Talk's mark, the same drawing as the application icon.
const LOGO: &str = "<svg class=\"logo\" viewBox=\"0 0 512 512\" aria-hidden=\"true\">\
<defs><linearGradient id=\"lb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6366f1\"/><stop offset=\"1\" stop-color=\"#8b5cf6\"/></linearGradient></defs>\
<circle cx=\"256\" cy=\"256\" r=\"240\" fill=\"url(#lb)\"/>\
<path d=\"M100 256C140 200 180 180 220 200C260 220 280 280 320 256C360 232 380 180 412 256\" fill=\"none\" stroke=\"#fff\" stroke-width=\"36\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\
<path d=\"M120 300C160 340 200 360 256 340C312 320 352 280 392 300\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".5\" stroke-width=\"24\" stroke-linecap=\"round\"/>\
<circle cx=\"100\" cy=\"256\" r=\"18\" fill=\"#fff\"/></svg>";

// The page cannot reach the application's assets, so the typeface travels inside it.
const OUTFIT_400: &[u8] = include_bytes!("../../assets/fonts/outfit-latin-400-normal.woff2");
const OUTFIT_600: &[u8] = include_bytes!("../../assets/fonts/outfit-latin-600-normal.woff2");

fn font_face(weight: u32, data: &[u8]) -> String {
    format!(
        "@font-face{{font-family:Outfit;font-weight:{};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,{}) format(\"woff2\")}}",
        weight,
        base64::engine::general_purpose::STANDARD.encode(data)
    )
}

/// The full HTML document for a page.
pub fn render(page: Page, french: bool) -> String {
    let text = texts(page, french);
    let (mark, tone) = match page {
        Page::Done => (MARK_OK, "ok"),
        _ => (MARK_FAIL, "fail"),
    };
    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Talk</title><style>{face_400}{face_600}\
:root{{color-scheme:dark light;--bg:oklch(0.13 0.01 260);--fg:oklch(0.95 0.01 260);--card:oklch(0.15 0.01 260);--line:oklch(0.25 0.015 260);--muted:oklch(0.65 0.01 260);--ok:oklch(0.70 0.17 145);--bad:oklch(0.55 0.20 25)}}\
@media(prefers-color-scheme:light){{:root{{--bg:oklch(0.97 0.005 260);--fg:oklch(0.20 0.015 260);--card:oklch(0.99 0.003 260);--line:oklch(0.86 0.008 260);--muted:oklch(0.45 0.01 260);--ok:oklch(0.52 0.17 145);--bad:oklch(0.48 0.20 25)}}}}\
*{{box-sizing:border-box}}\
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font:400 16px/1.5 Outfit,system-ui,sans-serif}}\
.card{{width:100%;max-width:420px;padding:48px 40px 44px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:12px}}\
.logo{{display:block;width:40px;height:40px;margin:0 auto 32px}}\
.mark{{width:56px;height:56px;margin:0 auto 24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid currentColor}}\
.mark svg{{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}}\
.ok{{color:var(--ok)}}.fail{{color:var(--bad)}}\
h1{{margin:0 0 12px;font-size:22px;font-weight:600}}\
p{{margin:0;font-size:15px;color:var(--muted)}}\
</style></head><body><main class=\"card\">{logo}\
<div class=\"mark {tone}\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">{mark}</svg></div>\
<h1>{title}</h1><p>{message}</p></main></body></html>",
        lang = if french { "fr" } else { "en" },
        face_400 = font_face(400, OUTFIT_400),
        face_600 = font_face(600, OUTFIT_600),
        logo = LOGO,
        tone = tone,
        mark = mark,
        title = escape(text.title),
        message = escape(text.message),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn french_is_chosen_by_the_accept_language_header() {
        assert!(prefers_french("GET / HTTP/1.1\r\nAccept-Language: fr-FR,fr;q=0.9,en;q=0.8\r\n\r\n"));
        assert!(!prefers_french("GET / HTTP/1.1\r\nAccept-Language: en-US,fr;q=0.5\r\n\r\n"));
        assert!(!prefers_french("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"));
    }

    #[test]
    fn the_pages_are_self_contained_and_localised() {
        let html = render(Page::Done, true);
        assert!(html.contains("Connexion réussie"));
        assert!(html.contains("Vous pouvez fermer cet onglet"));
        assert!(html.contains("font-family:Outfit") && html.contains("data:font/woff2;base64,"));
        assert!(!html.contains("<script") && !html.contains("setInterval"));
        assert!(!html.contains("http://") && !html.contains("https://") && !html.contains("src="));
        let refused = render(Page::Refused, false);
        assert!(refused.contains("Sign-in was refused"));
        assert!(!refused.contains("<script"));
    }

    #[test]
    fn dynamic_text_is_escaped() {
        assert_eq!(escape("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    }
}
