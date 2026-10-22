//! Installing BlackHole from Talk on a Mac, so that meeting mode needs no trip to a terminal.
//!
//! The driver is not bundled, its licence keeping it out of the application: it is fetched
//! from its maker at the moment the user asks, at a pinned version whose SHA-256 is checked
//! before anything runs. A driver goes into the system, so macOS asks for the administrator
//! password in its own dialog; the installer then runs, and the audio service is restarted so
//! the new device is listed without a reboot.

use sha2::{Digest, Sha256};

/// The version and digest Homebrew's blackhole-2ch cask pins. The package is signed with the
/// maker's Developer ID Installer certificate and notarised by Apple.
const URL: &str = "https://existential.audio/downloads/BlackHole2ch-0.7.1.pkg";
const SHA256: &str = "57b540f27a3e29c37e310e01bee0fdfab76733087e47f997ef9dccf851400dcf";

/// Why the installation did not happen.
#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("download failed: {0}")]
    Download(String),
    #[error("the downloaded package is not the expected one")]
    Digest,
    #[error("the administrator password was not given")]
    Declined,
    #[error("the installer failed: {0}")]
    Installer(String),
}

/// Fetch, check and install. Blocks for as long as the user takes over the password dialog.
pub async fn install() -> Result<(), InstallError> {
    let bytes = reqwest::get(URL)
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| InstallError::Download(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| InstallError::Download(e.to_string()))?;

    let digest: String = Sha256::digest(&bytes).iter().map(|b| format!("{:02x}", b)).collect();
    if digest != SHA256 {
        return Err(InstallError::Digest);
    }

    let dir = std::env::temp_dir().join(format!("talk-blackhole-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| InstallError::Download(e.to_string()))?;
    let package = dir.join("BlackHole2ch.pkg");
    std::fs::write(&package, &bytes).map_err(|e| InstallError::Download(e.to_string()))?;

    let installed = tokio::task::spawn_blocking(move || run_installer(&package))
        .await
        .map_err(|e| InstallError::Installer(e.to_string()))?;
    let _ = std::fs::remove_dir_all(&dir);
    installed
}

fn run_installer(package: &std::path::Path) -> Result<(), InstallError> {
    // The path is Talk's own temporary folder, but it is still quoted for the shell and then
    // for AppleScript, rather than trusted to hold no quote.
    let shell = format!(
        "/usr/sbin/installer -pkg {} -target / && (/usr/bin/killall coreaudiod || true)",
        shell_quote(&package.to_string_lossy())
    );
    let script = format!(
        "do shell script \"{}\" with administrator privileges with prompt \"Talk installs BlackHole, the virtual microphone meeting mode sends your voice to.\"",
        shell.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| InstallError::Installer(e.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&output.stderr).to_string();
    // osascript reports a cancelled password dialog as error -128.
    if error.contains("-128") {
        Err(InstallError::Declined)
    } else {
        Err(InstallError::Installer(error.trim().to_string()))
    }
}

fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_with_a_quote_stays_one_argument() {
        assert_eq!(shell_quote("/tmp/it's here"), "'/tmp/it'\\''s here'");
    }
}
