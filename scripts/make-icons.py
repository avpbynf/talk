"""Render every icon of the application from the SVG sources in docs/icon.

The four SVG there are the only source: the word Talk in Geist, outlined, on the
dark square, in a standard drawing and a heavier, tighter one for 16 to 24 pixels,
each rounded and squared. This script writes everything else, the PNG beside the
sources, the favicon, and the whole of src-tauri/icons except the installer
bitmaps, which `make-installer-images.py` draws from the icon.png written here.

    uv run --with resvg-py --with pillow python scripts/make-icons.py
"""

from __future__ import annotations

import io
import re
import struct
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "docs" / "icon"
ICONS = ROOT / "src-tauri" / "icons"
PUBLIC = ROOT / "public"

# Up to this size the small drawing is used, above it the standard one.
SMALL = 24

DOC_SIZES = (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024)

DESKTOP = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "StoreLogo.png": 50,
    **{f"Square{n}x{n}Logo.png": n for n in (30, 44, 71, 89, 107, 142, 150, 284, 310)},
}

# The first layer is the one Tauri takes as the window icon.
ICO_SIZES = (32, 16, 24, 48, 64, 256)

ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)

# The tray takes one bitmap, picked by the scale of the screen at start.
TRAY_SIZES = (16, 24, 32)

# Launcher and adaptive foreground sizes per density.
ANDROID = {
    "mdpi": (48, 108),
    "hdpi": (49, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

IOS = {
    "AppIcon-20x20@1x.png": 20,
    "AppIcon-20x20@2x.png": 40,
    "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29@1x.png": 29,
    "AppIcon-29x29@2x.png": 58,
    "AppIcon-29x29@2x-1.png": 58,
    "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x.png": 80,
    "AppIcon-40x40@2x-1.png": 80,
    "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120,
    "AppIcon-60x60@3x.png": 180,
    "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
    "AppIcon-512@2x.png": 1024,
}


def source(shape: str, size: int) -> str:
    """The SVG text of a shape, in the drawing meant for that size."""
    suffix = "-small" if size <= SMALL else ""
    return (SOURCES / f"talk-{shape}{suffix}.svg").read_text(encoding="utf-8")


def render(svg: str, size: int) -> bytes:
    """An SVG rendered as a PNG of size by size pixels."""
    return resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)


def png(shape: str, size: int) -> bytes:
    """The icon of a shape as a PNG at a size."""
    return render(source(shape, size), size)


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(path.relative_to(ROOT))


def round_variant(svg: str) -> str:
    """The rounded drawing on a disc, for the launchers that want a round icon."""
    return re.sub(r"<rect [^>]*?fill=", '<circle cx="12" cy="12" r="12" fill=', svg, count=1)


def foreground(svg: str) -> str:
    """The glyph alone on a transparent canvas, inside the safe zone of an adaptive icon.

    An adaptive icon is 108 units wide and keeps its middle 66 safe from the mask,
    so the 24 unit square is drawn at 66 of 108.
    """
    glyph = re.search(r"<path [^>]*/>", svg).group(0)
    side = 24 * 108 / 66
    start = (24 - side) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{start:.3f} {start:.3f} {side:.3f} {side:.3f}">'
        f"{glyph}</svg>"
    )


def ico(layers: list[bytes], sizes: tuple[int, ...]) -> bytes:
    """An ICO holding one PNG layer per size, in the order given."""
    head = struct.pack("<HHH", 0, 1, len(layers))
    offset = 6 + 16 * len(layers)
    entries = b""
    for data, size in zip(layers, sizes):
        side = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return head + entries + b"".join(layers)


def docs() -> None:
    for shape in ("rounded", "squared"):
        for size in DOC_SIZES:
            write(SOURCES / f"talk-{shape}-{size}.png", png(shape, size))


def desktop() -> None:
    for name, size in DESKTOP.items():
        write(ICONS / name, png("rounded", size))
    for size in TRAY_SIZES:
        write(ICONS / f"tray-{size}.png", png("rounded", size))
    write(ICONS / "icon.ico", ico([png("rounded", n) for n in ICO_SIZES], ICO_SIZES))
    images = [Image.open(io.BytesIO(png("rounded", n))) for n in ICNS_SIZES]
    target = ICONS / "icon.icns"
    images[-1].save(target, append_images=images[:-1])
    print(target.relative_to(ROOT))
    write(ICONS / "app-icon.svg", source("rounded", 1024).encode())
    write(PUBLIC / "favicon.svg", source("rounded", 1024).encode())


def android() -> None:
    standard = source("rounded", 1024)
    for density, (size, layer) in ANDROID.items():
        folder = ICONS / "android" / f"mipmap-{density}"
        write(folder / "ic_launcher.png", png("rounded", size))
        write(folder / "ic_launcher_round.png", render(round_variant(source("rounded", size)), size))
        write(folder / "ic_launcher_foreground.png", render(foreground(standard), layer))
    background = re.search(r'<rect [^>]*fill="(#[0-9a-f]+)"', standard).group(1)
    values = ICONS / "android" / "values" / "ic_launcher_background.xml"
    values.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'  <color name="ic_launcher_background">{background}</color>\n</resources>',
        encoding="utf-8",
        newline="\n",
    )
    print(values.relative_to(ROOT))


def ios() -> None:
    for name, size in IOS.items():
        write(ICONS / "ios" / name, png("squared", size))


def main() -> None:
    docs()
    desktop()
    android()
    ios()


if __name__ == "__main__":
    main()
