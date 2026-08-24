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

def js_string(text: str) -> str:
    """JSON-encode for embedding inside a <script> block.

    json.dumps escapes quotes but not ``</script>``, and an HTML parser ends the script at the
    first one it sees regardless of JavaScript string context. Inlining a whole HTML document
    without escaping it therefore truncates the page at that point and everything after it
    silently disappears.
    """
    return json.dumps(text).replace("</", "<\\/")


app = pathlib.Path("build/kerbside-app.html").read_text()
template = pathlib.Path("tools/landing_template.html").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "build/landing.html")
out.parent.mkdir(parents=True, exist_ok=True)
APP_URL = "https://claude.ai/code/artifact/792e815f-0a05-4135-8b86-28299c1be520"

out.write_text(
    template.replace("__SHOTS__", json.dumps(shots))
    .replace("__APP__", js_string(app))
    .replace("__APP_URL__", APP_URL)
)
print(f"{len(shots)} demo frames, app {len(app) / 1e6:.2f} MB")
print(f"{out}: {out.stat().st_size / 1e6:.2f} MB")
