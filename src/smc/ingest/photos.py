"""Reading real photographs, including iPhone HEIC.

Three things routinely go wrong with phone photos in a vision pipeline, and all three present
as something else entirely:

* **EXIF orientation.** iPhones store the sensor readout unrotated and record the rotation as a
  tag. Load the pixels without applying it and half the library is sideways — matching then
  fails between a portrait and a landscape shot of the same corner, and it looks like a matcher
  problem rather than a loader problem. This is the single most common cause of "the features
  are wrong" on phone imagery.
* **HEIC.** The iPhone default since iOS 11. OpenCV cannot read it; a naive loader silently
  skips every photo and reports an empty folder.
* **Resolution mismatch.** An iPhone shoots 4032x3024; the Meta toolkit delivers 1440x1080.
  Calibrating on the full-resolution iPhone file measures a camera the product does not have.
  :func:`load_photo` can downscale to the glasses spec so the comparison is honest — and
  running both is itself the interesting experiment: it says how much of the matching
  performance was bought with resolution the glasses will never deliver.

EXIF also carries the 35 mm-equivalent focal length, which gives usable intrinsics for free.
Not as good as a calibration target, and far better than a guess.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

#: 35 mm film frame width, the reference for "35 mm equivalent" focal lengths.
FILM_WIDTH_MM = 36.0

SUPPORTED = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp", ".bmp")


@dataclass(frozen=True, slots=True)
class PhotoMeta:
    """What a photograph tells us about the camera that took it."""

    path: Path
    width: int
    height: int
    #: 35 mm-equivalent focal length in mm, when EXIF records it.
    focal_35mm: float | None = None
    camera: str = ""
    orientation_applied: bool = False
    downscaled_from: tuple[int, int] | None = None

    @property
    def is_portrait(self) -> bool:
        return self.height > self.width

    def focal_px(self) -> float | None:
        """Pinhole focal length in pixels, from the 35 mm equivalent.

        ``focal_px = width_px * f35 / 36``. Assumes square pixels, no skew, and the full sensor
        width mapped to the frame — all fine for this purpose, none true to the last decimal.
        """
        if self.focal_35mm is None or self.focal_35mm <= 0:
            return None
        return float(self.width) * self.focal_35mm / FILM_WIDTH_MM

    def intrinsics(self) -> np.ndarray | None:
        focal = self.focal_px()
        if focal is None:
            return None
        from smc.mapping.pose import intrinsics

        return intrinsics(focal, self.width / 2.0, self.height / 2.0)

    def describe(self) -> str:
        bits = [f"{self.width}x{self.height}"]
        if self.camera:
            bits.append(self.camera)
        if self.focal_35mm:
            bits.append(f"{self.focal_35mm:.0f}mm eq")
        if self.orientation_applied:
            bits.append("rotated")
        if self.downscaled_from:
            bits.append(f"from {self.downscaled_from[0]}x{self.downscaled_from[1]}")
        return " · ".join(bits)


def _open(path: Path):
    from PIL import Image

    if path.suffix.lower() in (".heic", ".heif"):
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise RuntimeError(
                f"{path.name} is HEIC; install pillow-heif to read iPhone photos"
            ) from exc
    return Image.open(path)


def load_photo(
    path: Path,
    *,
    max_width: int | None = None,
    to_glasses_resolution: bool = False,
) -> tuple[np.ndarray, PhotoMeta]:
    """Load a photograph as RGB, with EXIF orientation applied.

    ``to_glasses_resolution`` downscales to 1440 px wide, matching what the Meta toolkit
    delivers, so a calibration run measures the camera the product actually has.
    """
    from PIL import Image, ImageOps

    image = _open(path)
    original = (image.width, image.height)
    exif = _read_exif(image)

    # Must happen before anything reads pixel coordinates.
    rotated = ImageOps.exif_transpose(image)
    orientation_applied = (rotated.width, rotated.height) != original
    image = rotated.convert("RGB")

    target = 1440 if to_glasses_resolution else max_width
    downscaled_from: tuple[int, int] | None = None
    if target is not None and image.width > target:
        downscaled_from = (image.width, image.height)
        height = round(image.height * target / image.width)
        image = image.resize((target, height), Image.LANCZOS)

    return np.asarray(image), PhotoMeta(
        path=path,
        width=image.width,
        height=image.height,
        focal_35mm=exif.get("focal_35mm"),
        camera=str(exif.get("camera", "")),
        orientation_applied=orientation_applied,
        downscaled_from=downscaled_from,
    )


def _read_exif(image) -> dict[str, object]:
    """Pull the few EXIF fields that matter. Absent EXIF is normal, not an error."""
    out: dict[str, object] = {}
    try:
        raw = image.getexif()
    except Exception:  # pragma: no cover - defensive, EXIF parsers are fragile
        return out
    if not raw:
        return out

    from PIL import ExifTags

    tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
    nested = {}
    try:
        for k, v in raw.get_ifd(0x8769).items():
            nested[ExifTags.TAGS.get(k, k)] = v
    except Exception:  # pragma: no cover
        pass
    tags.update(nested)

    if (f35 := tags.get("FocalLengthIn35mmFilm")) not in (None, 0):
        out["focal_35mm"] = float(f35)
    make = str(tags.get("Make", "")).strip()
    model = str(tags.get("Model", "")).strip()
    if make or model:
        out["camera"] = f"{make} {model}".strip()
    return out


def discover_photos(directory: Path) -> list[Path]:
    return sorted(p for p in directory.iterdir() if p.suffix.lower() in SUPPORTED)


def write_synthetic_iphone_photo(path: Path, image: np.ndarray, *, focal_35mm: float = 26.0,
                                 orientation: int = 6) -> Path:
    """Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.

    ``orientation=6`` means "rotate 90° clockwise on display", the tag an iPhone writes for a
    photo taken in portrait — the exact case that breaks a loader which ignores EXIF.
    """
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    pil = Image.fromarray(np.asarray(image, dtype=np.uint8))
    exif = pil.getexif()
    exif[274] = orientation
    exif[271] = "Apple"
    exif[272] = "iPhone 15 Pro"
    exif[0x8769] = {41989: int(focal_35mm)}
    pil.save(path, "JPEG", quality=92, exif=exif)
    return path
