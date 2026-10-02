//! The page the browser lands on after Google sign-in, served from the
//! loopback listener. Self-contained: inline CSS and a few lines of inline
//! script, no outside fetch.

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

/// Counts down on the success page, then asks the browser to close the tab.
/// Browsers refuse that for a tab the page did not open, so when the tab is
/// still there the line falls back to the plain instruction.
fn closing_script(french: bool) -> String {
    let (counting, plain) = if french {
        ("Cet onglet se fermera dans ", "Vous pouvez fermer cet onglet et retourner dans Talk.")
    } else {
        ("This tab will close in ", "You can close this tab and go back to Talk.")
    };
    format!(
        "<script>(function(){{var n=5,el=document.getElementById('msg');\
function show(){{el.textContent={counting:?}+n+' s'}}\
function plain(){{el.textContent={plain:?}}}\
show();var t=setInterval(function(){{n--;if(n>0){{show();return}}clearInterval(t);\
try{{window.close()}}catch(e){{}}setTimeout(plain,400)}},1000)}})()</script>",
        counting = counting,
        plain = plain,
    )
}

/// The full HTML document for a page.
pub fn render(page: Page, french: bool) -> String {
    let text = texts(page, french);
    let (mark, tone) = match page {
        Page::Done => (MARK_OK, "ok"),
        _ => (MARK_FAIL, "fail"),
    };
    let script = if page == Page::Done { closing_script(french) } else { String::new() };
    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Talk</title><style>\
:root{{color-scheme:dark light;--bg:#0f1115;--card:#171a21;--line:#262b36;--fg:#f2f4f8;--muted:#9aa3b2;--accent:#5b9df5;--bad:#f0616d}}\
@media(prefers-color-scheme:light){{:root{{--bg:#f4f5f8;--card:#fff;--line:#dfe3ea;--fg:#14171d;--muted:#566070;--accent:#2f6fd8;--bad:#c93545}}}}\
*{{box-sizing:border-box}}\
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,\"Segoe UI\",sans-serif}}\
.card{{width:100%;max-width:380px;padding:36px 32px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25)}}\
.mark{{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid currentColor}}\
.mark svg{{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}}\
.ok{{color:var(--accent)}}.fail{{color:var(--bad)}}\
h1{{margin:0 0 8px;font-size:20px;font-weight:600}}\
p{{margin:0;color:var(--muted)}}\
.name{{margin-top:24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}}\
</style></head><body><main class=\"card\">\
<div class=\"mark {tone}\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">{mark}</svg></div>\
<h1>{title}</h1><p id=\"msg\">{message}</p><div class=\"name\">Talk</div></main>{script}</body></html>",
        lang = if french { "fr" } else { "en" },
        tone = tone,
        mark = mark,
        title = escape(text.title),
        message = escape(text.message),
        script = script,
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
        assert!(html.contains("Cet onglet se fermera"));
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
