# Installing Talk

## Windows

Take the `.exe` from the [releases](https://github.com/avpbynf/talk/releases) page and run it.
It installs for the current user only and asks for no elevation of its own. It also sets up
[VB-Audio Virtual Cable](https://vb-audio.com/Cable/), the driver meeting mode needs; without
it, everything but meeting mode works.

The first launch opens the setup. **Local** detects the graphics card and downloads a Whisper
model from HuggingFace, cached in the application data folder, which keeps the installer down
to a few megabytes. **Server** asks for a URL, a key (a token for a Talk server) and optionally
a model, with a button that tests the connection. Either can be changed later on the Engine page.

### Updates

Shortly after launch, then once an hour for a window left open, Talk asks GitHub for the newest
release. A strip under the window buttons offers to install it, which runs the same installer,
closes the window and opens it again. The Settings page shows the running version and checks on
demand. An update installs only when it was signed with the key the release was built with.

### Uninstalling

Uninstalling leaves the models, `settings.json` and the history in place, so a reinstall finds
them, unless "Delete the application data" is ticked in the uninstaller, which removes them.

## Linux

Linux is in beta. Talk runs on Debian and Ubuntu with GNOME, under X11 and under Wayland
(GNOME 48 or later); another Wayland desktop needs the GlobalShortcuts and RemoteDesktop
portals, which not all of them have. There is no package on the releases page: build the
`.deb` with `bun run tauri:build:linux` as [docs/building.md](docs/building.md#debian-and-ubuntu)
describes, and install a newer one the same way.

Under Wayland the desktop asks two things, each once: to allow Talk's shortcuts, at the first
launch, and to allow it to type into other windows, at the first paste. It remembers both
answers, and a shortcut changed in the settings is asked about again. A refusal shows on the
overlay.

Under X11 the text is typed directly, so the setting that preserves the clipboard has no effect.
Under Wayland it is pasted through the clipboard, and preserving the clipboard puts back its text
only. Meeting mode, which needs the Windows VB-Cable driver, is unavailable. The model runs on
Vulkan and picks the discrete GPU; the driver must be visible to `vulkaninfo`. The microphone
and the output are chosen in the system's sound settings, which Talk follows.
