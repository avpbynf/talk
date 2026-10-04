//! The words of the messages shown before the interface exists, in the two
//! languages the application has.
//!
//! The language is the one the settings file names. That file may be the very
//! thing that cannot be read, so it is read here on its own, and a language it
//! does not give is the system's.

use crate::file_damage::Blocked;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    English,
    French,
}

/// The interface language: the one chosen in the settings, else the system's.
pub fn language() -> Language {
    let file = crate::settings::get_config_dir().join("settings.json");
    chosen(&std::fs::read(file).unwrap_or_default()).unwrap_or_else(system)
}

fn chosen(settings: &[u8]) -> Option<Language> {
    let settings = settings.strip_prefix(b"\xef\xbb\xbf").unwrap_or(settings);
    let document: serde_json::Value = serde_json::from_slice(settings).ok()?;
    match document.get("language")?.as_str()? {
        "fr" => Some(Language::French),
        "en" => Some(Language::English),
        _ => None,
    }
}

#[cfg(windows)]
fn system() -> Language {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    let mut name = [0u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(&mut name) };
    let name = String::from_utf16_lossy(&name[..usize::try_from(length).unwrap_or(0).saturating_sub(1)]);
    from_locale(&name)
}

#[cfg(not(windows))]
fn system() -> Language {
    Language::English
}

#[cfg(any(windows, test))]
fn from_locale(name: &str) -> Language {
    if name.to_ascii_lowercase().starts_with("fr") {
        Language::French
    } else {
        Language::English
    }
}

/// What a file holds, in the words of a sentence.
fn what_in(language: Language, what: &str) -> &str {
    match (language, what) {
        (Language::French, "settings") => "réglages",
        (Language::French, "shortcuts") => "raccourcis",
        _ => what,
    }
}

/// The message of an application that cannot start because of one of its files.
pub fn cannot_start(language: Language, what: &str, path: &Path, blocked: &Blocked) -> String {
    let what = what_in(language, what);
    let (path, reason) = (path.display(), blocked.reason());
    match (language, blocked) {
        (Language::English, Blocked::CannotOpen(_)) => format!(
            "Talk cannot start: its {what} file is in use by another program or cannot be accessed.\n\n{path}\n\n{reason}\n\n\
             Close whatever holds the file and start Talk again."
        ),
        (Language::English, Blocked::CannotKeepAside(_)) => format!(
            "Talk cannot start: its {what} file is not fully readable and a copy of it could not be kept, \
             so it was left as it is.\n\n{path}\n\n{reason}\n\n\
             Free some disk space or check the permissions of the folder, then start Talk again."
        ),
        (Language::French, Blocked::CannotOpen(_)) => format!(
            "Talk ne peut pas démarrer : son fichier de {what} est utilisé par un autre programme ou inaccessible.\n\n\
             {path}\n\n{reason}\n\nFermez ce qui retient le fichier, puis relancez Talk."
        ),
        (Language::French, Blocked::CannotKeepAside(_)) => format!(
            "Talk ne peut pas démarrer : son fichier de {what} n'a pas pu être lu en entier et une copie n'a pas pu en \
             être conservée, il a donc été laissé tel quel.\n\n{path}\n\n{reason}\n\n\
             Libérez de la place sur le disque ou vérifiez les droits du dossier, puis relancez Talk."
        ),
    }
}

/// The message owed about a file that was not fully readable and was kept aside.
pub fn damage(language: Language, what: &str, kept: &str) -> String {
    let what = what_in(language, what);
    match language {
        Language::English => format!(
            "Talk could not fully read its {what} file, so it started with what it could read and the \
             default {what} for the rest.\n\n\
             The original file was kept as:\n{kept}\n\n\
             What you change from now on is saved normally."
        ),
        Language::French => format!(
            "Talk n'a pas pu lire en entier son fichier de {what}, il a donc démarré avec ce qu'il a pu lire et les \
             {what} par défaut pour le reste.\n\n\
             Le fichier d'origine a été conservé sous :\n{kept}\n\n\
             Ce que vous modifiez désormais est enregistré normalement."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_language_of_the_settings_wins_and_a_missing_one_is_left_to_the_system() {
        assert_eq!(chosen(br#"{"language": "fr"}"#), Some(Language::French));
        assert_eq!(chosen(br#"{"language": "en"}"#), Some(Language::English));
        assert_eq!(chosen(b"{}"), None);
        assert_eq!(chosen(br#"{"language": "de"}"#), None);
        assert_eq!(chosen(b"{ half"), None);
        assert_eq!(chosen(b"\xef\xbb\xbf{\"language\": \"fr\"}"), Some(Language::French));
    }

    #[test]
    fn a_french_locale_is_french_and_any_other_is_english() {
        assert_eq!(from_locale("fr-FR"), Language::French);
        assert_eq!(from_locale("en-US"), Language::English);
        assert_eq!(from_locale(""), Language::English);
    }

    #[test]
    fn each_message_says_what_failed_in_both_languages() {
        let path = Path::new("C:/cfg/settings.json");
        let open = Blocked::CannotOpen("busy".to_string());
        let aside = Blocked::CannotKeepAside("disk full".to_string());

        assert!(cannot_start(Language::English, "settings", path, &open).contains("in use by another program"));
        assert!(cannot_start(Language::English, "settings", path, &aside).contains("could not be kept"));
        assert!(!cannot_start(Language::English, "settings", path, &aside).contains("in use by another program"));
        assert!(cannot_start(Language::French, "settings", path, &open).contains("fichier de réglages"));
        assert!(cannot_start(Language::French, "shortcuts", path, &aside).contains("raccourcis"));
        assert!(damage(Language::French, "shortcuts", "C:/k").contains("conservé sous"));
        assert!(damage(Language::English, "settings", "C:/k").contains("was kept as"));
    }
}
