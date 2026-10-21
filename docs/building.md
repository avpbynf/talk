# Building Talk

The native side compiles whisper.cpp from source, so budget a long first build.

## Debian and Ubuntu

Install [Tauri's Linux development dependencies](https://v2.tauri.app/start/prerequisites/)
and the audio, keyboard, and secret-service headers used by Talk:

```bash
sudo apt update
sudo apt install build-essential curl wget file libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf libasound2-dev libxkbcommon-dev libdbus-1-dev \
  cmake ninja-build clang libclang-dev libvulkan-dev vulkan-tools spirv-headers glslc
```

Install [Rust](https://rustup.rs/) and [Bun](https://bun.sh/), then from the repository root:

```bash
bun install
bun run tauri:dev:linux
```

The Linux command builds against the newest Vulkan SDK it finds under `~/vulkan`,
`/opt/vulkan`, or `/usr/local/vulkan`, and without one against the distribution's own
headers and `glslc`, which is enough on Ubuntu 26.04. An SDK installed elsewhere can be
selected by sourcing its `setup-env.sh` first. The launcher also refreshes an old
whisper.cpp CMake cache when it points at different Vulkan headers, and runs cargo with
the Rust version `src-tauri/rust-toolchain.toml` pins.

To make a local `.deb`, run `bun run tauri:build:linux`. The Linux configuration
selects the Debian bundle and does not create updater artifacts. What the package
needs to run is in [INSTALL.md](../INSTALL.md#linux).

Linux builds use Vulkan by default and select the discrete GPU automatically. The
Vulkan driver must be visible to `vulkaninfo`. Debian 12's Vulkan headers may be
too old for the current whisper.cpp backend; if the build reports missing
`LayerSettingEXT` types, install the current [Vulkan SDK](https://vulkan.lunarg.com/sdk/home).
Extracting it under `~/vulkan/<version>` is enough for the launcher to find it;
for example, `<version>` can be `1.4.363.0`. For any other location, source its
`setup-env.sh` before starting Talk.

## Windows

| Requirement | Why | Get it |
|---|---|---|
| Rust 1.90 | pinned by `src-tauri/rust-toolchain.toml` | [rustup.rs](https://rustup.rs) |
| Bun | frontend package manager and task runner | [bun.sh](https://bun.sh) |
| Visual Studio 2022 | the "Desktop development with C++" workload, Community or Build Tools | [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/) |
| CMake | whisper.cpp is a CMake project | [cmake.org](https://cmake.org/download/) |
| Ninja | the CMake generator used by `scripts/vcenv.bat` | [ninja-build.org](https://ninja-build.org) |
| LLVM | `whisper-rs-sys` generates its bindings with bindgen, which loads `libclang.dll` | [releases.llvm.org](https://releases.llvm.org) |
| Vulkan SDK | only for the default `vulkan` feature | [vulkan.lunarg.com](https://vulkan.lunarg.com/sdk/home) |

All but Visual Studio come from winget, which is quicker than seven download pages:

```bash
winget install Rustlang.Rustup Oven-sh.Bun Kitware.CMake Ninja-build.Ninja LLVM.LLVM KhronosGroup.VulkanSDK
```

```bash
bun install
bun run tauri:dev
```

`bun run tauri:build` produces the installer, and `bun run tauri:check` runs `cargo
check` without a full build. Use the `tauri:` scripts rather than calling `tauri`
directly: they go through `scripts/vcenv.bat`, which loads the MSVC environment CMake
needs.

To build without a GPU backend, disable the default `vulkan` feature:

```bash
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
```

## When the build fails

- **`cl.exe` not found.** The MSVC environment was not loaded. Run the `bun run tauri:`
  scripts rather than calling `tauri` directly.
- **A bindgen panic about `libclang`.** LLVM is not installed, or not where bindgen
  looks. Install it, or point `LIBCLANG_PATH` at the directory holding `libclang.dll`.
  The panic names no file of this project, which makes it read like a broken dependency.
  It is not one.
- **A path that is too long.** `vulkan-shaders-gen` nests its own build tree around 220
  characters deep, and the default target directory sits under the checkout, so the two
  together cross the Windows limit. MSBuild says so plainly, as `MSB4184` naming a path
  it cannot normalise. CMake, reached the same way, instead claims the C compiler cannot
  build a trivial program. Point the build somewhere short, which is what CI does:

  ```bash
  CARGO_TARGET_DIR=C:\rust-target bun run tauri:build
  ```

  The deepest file the build writes sits 219 characters below that directory, so
  anything up to about 40 characters works and a path under `Documents` does not.
  Moving the checkout helps too, but the target directory is the half that grows.
- **Meeting mode reports VB-Cable missing.** The app detects
  [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) by enumerating audio devices,
  and the NSIS installer is what installs the driver. A source build, or a declined
  prompt, leaves you without it: install it by hand and restart the app.

## Building the installer

`bun run tauri:build` runs `src-tauri/nsis-hooks.nsh`, which ships the contents of
`src-tauri/resources/VBCABLE_Driver/` and runs `VBCABLE_Setup_x64.exe` at install time.
Those driver binaries are not in the repository, since VB-Audio redistributes them under
its own terms: fetch the package from [vb-audio.com](https://vb-audio.com/Cable/) and
unpack it there before building an installer. Everything else builds without them.

The two bitmaps the wizard displays are committed next to the icons, and rebuilt by
`python scripts/make-installer-images.py` whenever the mark or the wordmark changes.

## The signing key

Every installer is signed, since an installation only accepts an update signed by the
private half of the key whose public half is in `tauri.conf.json`. `tauri build` reads
that key from `TAURI_SIGNING_PRIVATE_KEY`, either the key itself or the path to the
file holding it, and its password from `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Both are
repository secrets on CI; a local build needs them in the environment, and fails
without them rather than producing an installer nobody could update to.

Keep the key: signing with a new one strands every installation out there, since none
of them would accept it and every user would have to install by hand again.
