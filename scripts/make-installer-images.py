"""Regenerate the two bitmaps the NSIS installer displays.

NSIS reads them as plain 24-bit BMP at fixed sizes, so they cannot be produced by
the build: they are committed next to the icons and rebuilt by hand whenever the
mark changes. The mark is the word Talk itself, so the name is not written again
beside it.

    python scripts/make-installer-images.py

Needs Pillow, and draws its text in Geist, the face the application writes its
name in, from the variable font the sign-in page already carries.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
GEIST = ROOT / "src-tauri" / "assets" / "fonts" / "geist-latin-wght-normal.woff2"

TAGLINE = "Speech-to-Text"

# The dark theme tokens of the application, so the installer and the window it
# installs are recognisably the same product. --color-background at the top,
# --color-card at the bottom, --color-border on the edge.
TOP = (22, 23, 28)
BOTTOM = (27, 28, 35)
BORDER = (11, 12, 14)
MUTED = (138, 140, 152)


def canvas(width: int, height: int) -> Image.Image:
    """A vertical gradient between the two background tokens, with a hairline edge."""
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)),
        )
    draw.rectangle([0, 0, width - 1, height - 1], outline=BORDER)
    return image


def mark(size: int) -> Image.Image:
    """The application icon, resized and still carrying its alpha."""
    return Image.open(ICONS / "icon.png").convert("RGBA").resize(
        (size, size), Image.LANCZOS
    )


def font(weight: int, size: int) -> ImageFont.FreeTypeFont:
    face = ImageFont.truetype(str(GEIST), size)
    face.set_variation_by_axes([weight])
    return face


def centered(draw: ImageDraw.ImageDraw, text, y, face, fill, width) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=face)
    draw.text(((width - (right - left)) / 2 - left, y - top), text, font=face, fill=fill)


def sidebar() -> Image.Image:
    """164x314, shown on the welcome and finish pages."""
    width, height = 164, 314
    image = canvas(width, height)
    icon = mark(96)
    image.paste(icon, ((width - 96) // 2, 82), icon)
    draw = ImageDraw.Draw(image)
    centered(draw, TAGLINE, 196, font(400, 11), MUTED, width)
    return image


def header() -> Image.Image:
    """150x57, shown on every other page of the wizard."""
    width, height = 150, 57
    image = canvas(width, height)
    icon = mark(36)
    image.paste(icon, (12, (height - 36) // 2), icon)
    draw = ImageDraw.Draw(image)
    face = font(400, 11)
    _, top, _, bottom = draw.textbbox((0, 0), TAGLINE, font=face)
    draw.text((60, (height - (bottom - top)) / 2 - top), TAGLINE, font=face, fill=MUTED)
    return image


def main() -> None:
    for name, image in (("nsis-sidebar", sidebar()), ("nsis-header", header())):
        path = ICONS / f"{name}.bmp"
        image.save(path, "BMP")
        print(f"{path.relative_to(ROOT)}  {image.width}x{image.height}")


if __name__ == "__main__":
    main()
