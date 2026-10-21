<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="Talk">
</p>

<p align="center">
  Hold a key, say the sentence, and it is typed where you were already working.
</p>

<p align="center">
  <a href="https://github.com/avpbynf/talk/releases"><img src="https://img.shields.io/github/v/release/avpbynf/talk?style=flat-square&label=download&color=6366f1" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-6366f1?style=flat-square" alt="MIT"></a>
</p>

Talk is a desktop dictation app for Windows, and for Linux in beta. A global shortcut records your voice,
a Whisper model turns it into text, and the text lands in the window that already had focus.
The model runs on your own graphics card through whisper.cpp on Vulkan, with no account and
no upload, or on any server that speaks the OpenAI transcription API when this machine has no
card to spare.

![The Talk dashboard: time won at the keyboard, dictations, speaking speed, a year of activity, and what the same audio would have cost elsewhere](docs/images/dashboard.png)

## Quick start

- Take the Windows installer from the [releases](https://github.com/avpbynf/talk/releases) page
  and run it. It installs for the current user and asks for no elevation.
- The first launch opens a short setup: **Local** downloads a Whisper model for your graphics
  card, **Server** asks for a URL, a key and optionally a model, and can test the connection.
- Hold **Ctrl+Space** in any window, talk, let go. The text is typed where the caret was.

[INSTALL.md](INSTALL.md) covers updates, uninstalling, and Linux.

## What it does

- **Two engines.** Local runs a Whisper model on this machine, the GPU picked by name when
  there are two. Server mode points at a [Talk-Server](https://github.com/avpbynf/Talk-Server)
  or at any OpenAI-compatible endpoint: the URL field suggests the Talk servers found on the
  network and Mistral, OpenAI and Groq, and the model field lists what the provider offers,
  the most accurate first. When the server does not answer, the local model takes over
  mid-dictation unless that fallback is turned off.
- **Share this PC.** The model loaded here answers other machines on the network over the same
  API, paired with a code read off the screen. In server mode this PC relays their requests to
  its own server, key and model included. Your own dictation always goes first.
- **Dictation that stays out of the way.** Push-to-talk or toggle, text typed by keystroke or
  pasted through the clipboard, dictations queued while the previous one transcribes, the last
  one pasted again with Ctrl+Shift+Space, and a cancel shortcut.
- **An overlay in four styles**, Halo, Capsule, Orb and Windows, shown by default on the
  screen you are typing on, pinned to one of six spots or dragged anywhere.
- **A vocabulary** of the names and terms Whisper would otherwise mishear, handed to the model
  with every dictation.
- **A searchable history** with a size you choose, and a dashboard of what dictating saved you.
- **An optional Google account** that syncs settings, vocabulary, history and statistics
  across your machines through your own Google Drive.
- **A tray menu** to open the window, start or stop a dictation, and quit; launch at startup,
  gradient themes, an interface in English and French, and updates installed from the
  releases page.

![The Engine page in server mode on Mistral, the model field listing its Voxtral models with the most accurate first](docs/images/engine.png)

![The Recording overlay tab of the Appearance page: the four styles, Capsule picked and previewed while recording](docs/images/appearance.png)

![The History page: dictations with their time, model and engine, and a search field](docs/images/history.png)

What it does not do: Linux is in beta, tried on GNOME under X11 and Wayland, and is built
from source rather than updated from the releases page. Meeting mode, which
routes the microphone through VB-Cable for a call, is Windows only.

## Read more

| If you want to | Read |
| --- | --- |
| Install, update, or uninstall | [INSTALL.md](INSTALL.md) |
| Build from source on Windows, Debian or Ubuntu | [docs/building.md](docs/building.md) |
| Know what changed between versions | [CHANGELOG.md](CHANGELOG.md) |

## Contributing

A branch off `dev`, conventional commits and a pull request against `dev`.
[CONTRIBUTING.md](CONTRIBUTING.md) opens on the short version, what refuses a first push, and
carries the rest.

## Licence

MIT, in [LICENSE](LICENSE).
