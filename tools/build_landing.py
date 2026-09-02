"""Assemble the landing page: demo frames plus the whole app, inlined."""
from __future__ import annotations

import base64
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from PIL import Image  # noqa: E402

from smc.ingest.photos import discover_photos, load_photo  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from site_config import APP_URL, SITE_URL  # noqa: E402


def encode(path: pathlib.Path, width: int, quality: int = 72) -> str:
    image = Image.open(path).convert("RGB")
    if image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def encode_array(array, width: int, quality: int = 72) -> str:
    image = Image.fromarray(array)
    if image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


shots = []
demo = pathlib.Path("build/demo")
for name, tag in (
    ("recon_a.png", "Reconstructed corridor · kerb line and footway"),
    ("recon_b.png", "Same block from above · geometry, not photographs"),
    ("recon_c.png", "Walking height · what a wearer's camera sees"),
):
    path = demo / name
    if path.exists():
        shots.append({"src": encode(path, 900), "alt": tag, "tag": tag})

photos = discover_photos(pathlib.Path("photos/vantage"))
for path in photos[:: max(1, len(photos) // 3)][:3]:
    image, meta = load_photo(path, max_width=900)
    shots.append(
        {
            "src": encode_array(image, 900),
            "alt": "Footway captured on foot in San Francisco",
            "tag": "Real capture · San Francisco footway",
        }
    )

app = pathlib.Path("build/kerbside-app.html")
if not app.exists():
    sys.exit("build/kerbside-app.html is missing. Run tools/build_app.py first.")

template = pathlib.Path("tools/landing_template.html").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "build/landing.html")
out.parent.mkdir(parents=True, exist_ok=True)

# The landing page used to carry the whole app inlined as a string, so that its download button
# had something to hand over without a server. There is a server now -- GitHub Pages -- and the
# app is a real URL, so the page links to it instead. That is what makes the download work from
# the internet, and it takes several megabytes back out of the page.
out.write_text(
    template.replace("__SHOTS__", json.dumps(shots))
    .replace("__APP_URL__", APP_URL)
    .replace("__SITE_URL__", SITE_URL)
)
print(f"{len(shots)} demo frames, app hosted at {APP_URL}")
print(f"{out}: {out.stat().st_size / 1e6:.2f} MB")
