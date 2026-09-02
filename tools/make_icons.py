"""Draw the app icons.

An installable app needs real icons at real sizes: Chrome refuses to offer an install prompt
without at least a 192 and a 512, and Android crops anything that is not maskable into a circle.
Drawing them here rather than shipping binaries keeps the mark in step with the app's own header
and avoids a font dependency that would render differently on another machine.
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw

PINK = (212, 23, 107, 255)
WHITE = (255, 255, 255, 255)
INK = (12, 16, 21, 255)


def draw_k(draw: ImageDraw.ImageDraw, size: int, inset: float) -> None:
    """The K, as three thick strokes. Coordinates are fractions of the icon's side."""
    span = 1.0 - 2 * inset

    def at(x: float, y: float) -> tuple[float, float]:
        return (size * (inset + x * span), size * (inset + y * span))

    width = max(2, round(size * span * 0.15))
    cap = width / 2
    strokes = [(0.24, 0.10, 0.24, 0.90), (0.30, 0.50, 0.80, 0.11), (0.30, 0.50, 0.80, 0.89)]
    for x0, y0, x1, y1 in strokes:
        draw.line([at(x0, y0), at(x1, y1)], fill=WHITE, width=width)
        # Pillow draws butt caps, which leave the diagonals looking chipped at this weight.
        for x, y in ((x0, y0), (x1, y1)):
            cx, cy = at(x, y)
            draw.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=WHITE)


def rounded(size: int, radius_ratio: float) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    r = round(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=PINK)
    return image


def any_icon(size: int) -> Image.Image:
    image = rounded(size, 0.22)
    draw_k(ImageDraw.Draw(image), size, inset=0.20)
    return image


def maskable_icon(size: int) -> Image.Image:
    # Android crops maskable icons to whatever shape the launcher uses, and only the central 80%
    # is guaranteed to survive. So the ground is full bleed and the mark sits well inside it.
    image = Image.new("RGBA", (size, size), PINK)
    draw_k(ImageDraw.Draw(image), size, inset=0.28)
    return image


def main(out: pathlib.Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    any_icon(192).save(out / "icon-192.png")
    any_icon(512).save(out / "icon-512.png")
    maskable_icon(512).save(out / "icon-maskable-512.png")
    # Apple ignores the manifest and reads this tag instead, on an opaque background.
    apple = Image.new("RGBA", (180, 180), INK)
    apple.alpha_composite(any_icon(180))
    apple.convert("RGB").save(out / "apple-touch-icon.png")
    print(f"icons -> {out}")


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs"))
