# Talk-Client

Tauri v2 desktop Speech-to-Text app, Windows only. Rust backend, React 19 frontend.
See [README.md](README.md) for features, build requirements and troubleshooting.

## Commands

```bash
bun install
bun run tauri:dev      # dev build, MSVC env loaded by scripts/vcenv.bat
bun run tauri:build    # production installer
bun run tauri:test-installer  # installer stamped 0.10.0-dev.N, a new N each build
bun run tauri:check    # cargo check, no full build
bun run dev            # frontend alone, no Tauri shell
bun run test           # frontend suite, vitest on jsdom
bun run test:coverage  # same, with a coverage report
bun run test:rust      # cargo test, MSVC env loaded the same way
```

Run `bun run tauri:check` before committing. The native side compiles whisper.cpp,
so a cold build takes a long while. `tauri:check` is the fast feedback loop.

`bun run test` is the fast one: it never touches the native side, so it answers in
seconds. `test:rust` pays the whisper.cpp build the first time in any fresh worktree.

Call cargo through `test:rust` and not directly. `cargo test` on its own inherits
whatever environment the shell has, and without the MSVC one loaded the native
build fails in ways that read like a Rust error.

## Layout

- `src-tauri/src/lib.rs` registers commands and owns app state
- `src-tauri/src/transcription/`, `models/`, `audio/` are the local engine
- `src-tauri/src/server_transcription.rs` is the remote path
- `src-tauri/src/virtual_mic/` detects and routes through VB-Cable
- `src/views/` are the settings pages, `src/pages/` the overlay and setup wizard

## Branches

`dev` is where work lands, `main` is what has been released, and `main` is an exact prefix of
`dev`. A batch takes its own branch off `dev`, named `<type>/what-it-does`, and comes back by
pull request merged with the rebase button. `dev` reaches `main` by a fast-forward and by no
button, at a release, and the tag is what publishes.

**All of it is in [CONTRIBUTING.md](CONTRIBUTING.md)**, which is the only home for it: the
branch names, the commit subjects, the labels, the changelog, where the version lives and the
order a release goes out in. `.githooks/commit-msg` refuses what does not match, and the
workflows run that same file.

## Conventions

- English in code and comments
- Conventional Commits, in commit messages and pull request titles alike
- Everything is written LF, and a CRLF appearing is a tooling regression

## Things that bite

- **Build environment.** `scripts/vcenv.bat` finds `vcvarsall.bat` through vswhere and
  loads the MSVC x64 environment. Never add a redirection inside its vswhere
  backticks: escaping one breaks the quoted path and the probe silently finds
  nothing. `vcvarsall.bat` is itself noisy on stderr even on success, which is why the
  call is silenced and judged on its exit code.
- **Path length.** `vulkan-shaders-gen` nests its CMake scratch directories about 220
  characters deep on their own, so the checkout has to stay short, well under 50
  characters. The symptom is misleading: CMake reports that the C compiler cannot
  build a trivial program, naming a `TryCompile-*` directory rather than the length.
  A short checkout is not always enough either, since the target directory sits in
  the middle of that path. CI sets `CARGO_TARGET_DIR` to a root-level directory, and
  a local build needs the same. From `Documents\GitHub\t4lk\Talk-Client`, which is
  only 48 characters, the default target directory still crosses the limit, and the
  message that comes back is MSBuild's `MSB4184` rather than anything about CMake.
- **GPU is optional.** `vulkan` is a default feature, and `--no-default-features` builds
  without the Vulkan SDK.
- **`gpu_device` is a rank among the GPUs, not a device id.** whisper walks the ggml
  device registry, keeps what calls itself a GPU or an integrated GPU, and the parameter
  is a position in that filtered list. `list_gpu_devices()` walks the same registry the
  same way, which is what makes the index it hands the frontend mean anything. Going
  through the Vulkan entry points instead would read the same cards but skip the catch
  the registry puts around a driver that fails to come up, and a C++ exception crossing
  back into Rust takes the process with it. Reading the registry is also why `whisper-rs`
  carries the `raw-api` feature: that is what re-exports the sys crate.
- **An output stream stays on the endpoint it was opened on.** Nothing in cpal follows
  the Windows default afterwards, so a stream opened at startup kept sounding on the
  speakers when a headset arrived, and went silent when the device it held disappeared.
  `SoundEngine` names the device it should be on before each sound and reopens when the
  name has moved, which is why the worker thread owns the stream instead of handing a
  handle out. The same trap waits for anything else that opens an audio device once.
- **`set_always_on_top(true)` does nothing on a window that already carries the flag.**
  tao keeps it in its own window state and `WindowFlags::apply_diff` returns early when
  nothing changed, so a window built with `always_on_top(true)` never emits a second
  `SetWindowPos` however often it is asked. `show()` is `ShowWindow(SW_SHOW)` and leaves
  the z-order where it found it. Windows takes a window out of the topmost band on its
  own account, and the overlay then draws behind everything on screen until the process
  restarts and builds the window again. `overlay::raise()` asks for `HWND_TOPMOST`
  itself, and anything else that has to stay in front needs the same.
- **The VB-Cable payload is absent.** `src-tauri/nsis-hooks.nsh` ships
  `src-tauri/resources/VBCABLE_Driver/` and runs its setup at install time, but those
  binaries were Git LFS objects and the objects are gone from the remote. Fetch
  VB-Cable from vb-audio.com and unpack it there before building an installer.
- **There are two modes and `Local` is the default.** `TranscriptionMode` is picked in
  the setup wizard and changed on the Transcription page. Neither is a degraded
  version of the other. `server_fallback` applies inside server mode only, so a
  machine dictating badly may be in server mode falling back silently, or in local
  mode with a bad model. Check which mode it is in before anything else.
- **The old name still points at real data, and not where you would guess.**
  `ProjectDirs::from("com", "avpbynf", "t4lk")`, called in four places, resolves on
  Windows to `%APPDATA%\avpbynf\t4lk`: the crate drops the qualifier, and only the
  last argument carries the name. `settings.json`, `t4lk.db` and the downloaded
  models all live there, better than a gigabyte of them. The bundle identifier
  `com.avpbynf.t4lk` is a separate string that names the WebView2 profile under
  `%LOCALAPPDATA%`, and nothing worth keeping is under it. Renaming either needs a
  migration written first, not a find and replace.
- **`AppTheme` carries a `serde(alias)` on each of its two renamed variants.**
  `load_settings()` drops the whole file on a parse error and returns the defaults,
  so a settings file still holding `t4lk-dark` would take the server URL, the token
  and the shortcuts down with it.
- **A new settings field needs `#[serde(default)]`, always.** `load_settings()` drops the
  whole file on a parse error, so `offered_servers` without its default would turn every
  existing install back to the defaults on the first launch after the update, server URL
  and token included. `settings.rs` carries a test for it.
- **The uninstall key is the product name, not the identifier.** Tauri builds it as
  `Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}`, so renaming
  the product makes every earlier install invisible to the new one and Windows lists
  two applications. `NSIS_HOOK_PREINSTALL` retires the `T4lk` entry by deleting its
  keys and its directory. It must never do that by running the old uninstaller, whose
  own hook reaches into the data directory. Any future rename needs the same treatment.
- **The installer bitmaps carry the wordmark.** `src-tauri/icons/nsis-header.bmp` and
  `nsis-sidebar.bmp` are 24-bit BMP at sizes NSIS fixes, so they cannot be produced by
  the build. `python scripts/make-installer-images.py` redraws both from the real icon
  and the real Outfit face. Run it after any change to the mark.
- **Feedback loops are not symmetric.** The frontend checks in seconds with
  `bun run build`, which is the same `tsc` pass the release runs. The Rust side cannot
  be checked at all without CMake, Ninja, the Vulkan SDK and an LLVM install, because
  `whisper-rs-sys` compiles whisper.cpp from its build script and generates its
  bindings with bindgen. Even `cargo check` runs both. Missing LLVM is the one that
  misleads, since bindgen panics about `libclang.dll` and names no file of ours. On a
  machine without them, CI is the only verification and the loop is roughly twenty
  minutes, so read Rust changes carefully before pushing rather than iterating on the
  runner.
- **An unsigned release is silently never offered as an update.** `createUpdaterArtifacts`
  makes the bundler write `latest.json` and a `.sig` beside the installer, and it needs
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the
  environment: without them a build stops, saying it found a public key and no private
  one. CI holds both as repository secrets. The installed application polls
  `releases/latest/download/latest.json` and verifies it against the public key in
  `tauri.conf.json`, so anything published by a path that skips the signing still
  installs by hand and is simply never seen by an installed client. Signing with a
  different key does the same to every installation already out there.
