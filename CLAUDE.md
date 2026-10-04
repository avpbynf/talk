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
bun run test:ui        # interface suite, Playwright on Chromium, native side mocked
bun run test:ui:update # regenerate the visual baselines (Windows draws the real ones)
bun run test:rust      # cargo test, MSVC env loaded the same way
```

Run `bun run tauri:check` before committing. The native side compiles whisper.cpp,
so a cold build takes a long while. `tauri:check` is the fast feedback loop.

`bun run test` is the fast one: it never touches the native side, so it answers in
seconds. `test:rust` pays the whisper.cpp build the first time in any fresh worktree.

`bun run test:ui` is the one to run after touching a page, the sidebar or the styles. It starts
Vite on its own port (on CI, or locally with `E2E_BUILD=1`, one development-mode bundle served by
`vite preview`, so React still writes its development warnings), loads the real frontend in Chromium and answers every `invoke` and `listen`
from `e2e/native-mock.ts`, which fails a test naming any command it does not know. The browser is
fetched once with `bun run playwright install chromium-headless-shell`. Playwright needs Node and
Bun's own runtime cannot drive the browser (the launch hangs), so `node-win-x64` is a dev
dependency and `bun run` finds its `node`. Go through the scripts and not `bunx playwright`. A
failing snapshot is looked at before it is regenerated.

With the dev server, which is the local default, the suite reuses a server already listening on its
port, so two worktrees running it at once are both served the tree that started first, and the
second fails on pages it never touched. With the bundle (CI, or `E2E_BUILD=1`) a busy port is
refused instead. Either way, give each worktree its own port: `E2E_PORT=1441 bun run test:ui`.

The runner has no graphics card, so the suite is also the check on what the window costs when the
processor paints every layer: `E2E_SOFTWARE=1 bun run test:ui -- --workers 4` draws the same way
here. Anything that moves behind the content has to be cheap in software: the ambient lights are
gradients that are soft by construction and move by transform alone, the cards and the sidebar
carry no `backdrop-filter`, and `frame-budget.ts` pauses the lights when the frames come too slow.
A blur on a moving layer, or a backdrop blur over one, took that from 60 to 16 frames a second.

A check that walks the whole page (`e2e/layout-checks.ts`) reads each element's style once and
keeps the answer, since every question it asks climbs the ancestors and a read per ancestor per
element makes the size of the page the multiplier. Slow tests on the runner are mostly the pages
mounting in the development build, not these checks: look at a profile of the test before
suspecting its assertions.

The suite walks every page, and the Appearance page in particular: it opens clean at the three
window sizes, every shipped preset keeps the dashboard past the axe contrast check, an unreadable
base colour is corrected and announced, saved themes can be saved, removed and undone, the gradient
editor works from the keyboard, and the window buttons sit on either side, collapsed sidebar
included. A damaged cached theme must still boot to a visible window. The gradient editor has no
pixel snapshot on purpose. A test waits on the condition it needs (`app.settle()`,
`themeSettled()`, a polled axe run) and never on a delay: dnd-kit drops an arrow key pressed in the
tick after a pick-up, so the vocabulary test presses until the page says the key was taken.

Call cargo through `test:rust` and not directly. `cargo test` on its own inherits
whatever environment the shell has, and without the MSVC one loaded the native
build fails in ways that read like a Rust error.

## Layout

- `src-tauri/src/lib.rs` registers commands and owns app state
- `src-tauri/src/transcription/`, `models/`, `audio/` are the local engine
- `src-tauri/src/server_transcription.rs` is the remote path
- `src-tauri/src/virtual_mic/` detects and routes through VB-Cable
- `src/views/` are the settings pages, `src/pages/` the overlay and setup wizard
- `src/overlay/` draws the three overlay styles on one engine, and `src/views/appearance/overlay/`
  is their settings tab with its preview. `src-tauri/src/placement.rs` is the pure arithmetic of
  where the overlay goes, `overlay_settings.rs` the settings it reads

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
- **The overlay is placed before it is shown, and a move it reports is not always a drag.**
  `overlay::show()` calls `overlay::place()`, which picks the screen, sizes the window for that
  screen's scale and positions it inside its work area; the window then reports that it moved.
  Only a move the user started counts as a drag: the overlay page arms on a mouse press, and
  `dragged_to()` ignores a move that lands where `place()` put it, and forgets that corner once a
  drag is taken in. A position is kept as a share of the room on a screen's work area
  (`FreePosition`), never as pixels, and applies on whichever screen the rule picks; a drop on
  another screen only moves the rule when it is `Chosen`. A screen is remembered by the
  monitor's device path and not by `\\.\DISPLAYn`, which Windows renumbers. The path names the
  same monitor on the same connection: it embeds an id derived from the output, so another
  port or dock may read as a new screen, and a free position then falls back to the rule. An earlier build's
  absolute position is converted by `place()` the first time the screens are known, keeping its
  monitor, which is why `overlay_position` is still read and never written. What ends a hold after
  a paste or a refusal is judged by `overlay_feedback::Generation`, so an old timer cannot hide a
  newer state.
- **Nothing in the overlay may repaint every frame.** It sits over whatever the user is working
  in, so each style moves by transform and opacity only, from the one loop in
  `src/overlay/engine.ts`, which stops when nothing is shown. A conic gradient rotated by a
  custom property, a blur over something that moves, or a `backdrop-filter` (which blurs
  nothing over a transparent window anyway, so Glass is a translucent fill) cost a repaint of
  the whole window. The stylesheet's class names must not collide with `index.css`: a second
  `.shimmer` there silently took the capsule's text clip away.
- **The overlay look follows the account and reads leniently.** `overlay_look` carries
  `serde` defaults field by field, so a value this build cannot read costs that value and not
  the settings file. The look has its own modified time, compared on its own whatever stamp the
  file around it carries, so a stale look re-uploaded by another PC never beats a newer edit.
  A synced copy without it says nothing and gets this PC's own back;
  one this build cannot read in full is written back as it was (`sync/portable.rs`).
- **The VB-Cable payload is absent.** `src-tauri/nsis-hooks.nsh` ships
  `src-tauri/resources/VBCABLE_Driver/` and runs its setup at install time, but those
  binaries were Git LFS objects and the objects are gone from the remote. Fetch
  VB-Cable from vb-audio.com and unpack it there before building an installer.
- **There are two modes and `Local` is the default.** `TranscriptionMode` is picked in
  the setup wizard and changed on the Engine page. Neither is a degraded
  version of the other. `server_fallback` applies inside server mode only, so a
  machine dictating badly may be in server mode falling back silently, or in local
  mode with a bad model. Check which mode it is in before anything else.
- **Data lives under `%APPDATA%\avpbynf\Talk`, and the old `t4lk` folder is migrated.**
  `src-tauri/src/paths.rs` is the only place that builds the directories, through
  `ProjectDirs::from("com", "avpbynf", "Talk")`: on Windows the crate drops the
  qualifier and only the last argument carries the name. `config\` holds
  `settings.json`, `t4lk.db`, `hotkeys.json` and `sync.json`; `data\` holds the
  downloaded models, better than a gigabyte of them. The database file is still
  `t4lk.db` on purpose: renaming it beside its WAL is what made the move unsafe, so
  only the folder moves. `paths::init()` runs first in `run()` (before the
  single-instance plugin, because the app state is built ahead of it) and renames
  `%APPDATA%\avpbynf\t4lk` to `Talk` in one move. It deletes no file. A `Talk` that
  holds data wins and the old folder is left alone; a `Talk` with no settings and no
  database gives way to an old folder that has them, after its empty folders are
  removed; one holding stray files is left alone and the run uses the old folder.
  When a rename fails (a file held open) the run uses the old folder too and tries
  again at the next start. The bundle
  identifier `com.avpbynf.t4lk` is a separate string that names the WebView2 profile
  under `%LOCALAPPDATA%`; it still says t4lk, nothing worth keeping is under it, and
  changing it needs a migration of its own. Never add a path under the old name.
- **The theme is values, and the old theme names are still read.** `theme.rs` stores a
  preset id plus the values edited on top of it, and reads them field by field, so a
  field this build cannot parse costs that field and not the file. `load_settings()`
  drops the whole file on a parse error and returns the defaults, which would take the
  server URL, the token and the shortcuts with it. Settings written before this carry
  `app_theme` as a string (`t4lk-dark` among them); `parse_settings` turns it into the
  matching preset and never writes it back. A synced copy is different: one without a
  `theme` (a machine on the old release) says nothing about it, so the local theme
  stands and goes back up (a fresh machine signing in adopts the old name's preset), and
  a theme or saved theme this build cannot read in full, which includes one it would have
  to clamp or truncate, is not applied and is written back untouched; fields it does not
  know are carried and written back too. Saved themes merge one by one, by id and
  modification time, with tombstones for removals that are forgotten after ninety days. The old release's settings hash is
  still on disk after an upgrade, and `legacy_fingerprint` is what keeps that from
  reading as an edit. The preset ids live in `src/lib/theme.ts`, so a preset renamed
  there needs the mapping in `ThemeSettings::from_legacy` kept in step.
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
- **Share this PC takes WAV and nothing else.** The upload must open with RIFF and WAVE and
  goes straight to symphonia's WAV reader, never the default probe: the probe scans forward
  for any container, so a junk byte or an ID3 tag slips past a check on byte 0, and its MP4
  and MKV demuxers panic on a crafted header, which aborts the whole app in a release build.
  Talk clients send WAV, and another OpenAI client has to as well. The decoding runs after
  the one remote slot is taken, so a paired device cannot decode several uploads at once.
- **Share this PC binds `0.0.0.0`, and Windows asks about it.** The first time the server
  listens, Defender Firewall shows its "allow this app to communicate on these networks" prompt
  for Talk. Until it is allowed, the card reads Serving and a request from the same machine
  works, while every other machine times out, which looks like a server bug and is not one.
  Only a private network is ticked by default. The server and a local dictation also share the
  one engine behind `AppState.whisper_engine`, and the local one always wins: a remote job
  waits, one at a time and without holding the engine lock, until no dictation is recording
  or in flight, and whisper's abort callback stops it with a 503 as soon as a local recording
  starts. The pairing store lives in `ShareManager` and
  not in a running server, so ten wrong codes keep pairing off through a switch off and on,
  until Talk restarts, as on Talk-Server.
- **Google sign-in is compiled in, not configured.** `TALK_GOOGLE_CLIENT_ID` and
  `TALK_GOOGLE_CLIENT_SECRET` are read through `option_env!` when the Rust side compiles, so a
  build without them succeeds and the Account card simply says sign-in is not available. A
  local build needs them in the shell that runs `tauri:build` or `tauri:test-installer`, and
  release CI reads them from repository secrets of the same names. The client is a Desktop
  OAuth client in Google Cloud; while its consent screen is in testing, only the test users
  listed there can sign in.
