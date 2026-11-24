"""The building studio's local server: ``python -m kerbfront studio`` then open
http://127.0.0.1:8791/.

* ``GET  /``                         studio/ (index.html, building.mjs, editor.mjs, ...)
* ``GET  /api/models``               models/index.json
* ``GET  /api/models/<id>``          a model
* ``PUT  /api/models/<id>``          save an edited model (the previous version is kept under
                                     models/.history/, git-ignored); the edit is listed in
                                     ``model["edits"]`` by the studio
* ``GET  /api/photo/<frame>.jpg``    a frame as the studio's photo-match camera sees it:
  ``?yaw=<compass deg>&pitch=<deg>&hfov=<deg>&w=&h=`` re-projects a panorama to a perspective
  view; a perspective frame is returned as it is (2048 px)
* ``POST /api/snap/<name>``           save a PNG render (the studio's ``studio.snap(name)``) to
                                     out/snaps/, for stacking against rectified photos

Local only (binds 127.0.0.1). Mapillary pixels stay in the cache; nothing here is published.
"""

from __future__ import annotations

import json
import shutil
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import CACHE, LAB

STUDIO = LAB / "studio"
MODELS = LAB / "models"


def photo_view(frame_id: str, yaw: float | None, pitch: float, hfov: float, w: int, h: int,
               meta: dict | None = None) -> bytes:
    import cv2

    from .photos.pixels import equirect_view
    from .sources import mapillary

    img_path = None
    for size in ("original", 2048):
        p = CACHE / "thumbs" / f"{frame_id}_{size}.jpg"
        if p.exists():
            img_path = p
            break
    if img_path is None:
        img_path = mapillary.thumbnail(frame_id, "original" if (meta or {}).get("camera_type") == "spherical" else 2048)
    img = cv2.imread(str(img_path))
    if meta and meta.get("camera_type") == "spherical" and yaw is not None:
        out = equirect_view(img, (yaw - meta["heading"] + 540) % 360 - 180, pitch, hfov, w, h)
    else:
        out = img
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STUDIO), **kw)

    def log_message(self, fmt, *args):  # quiet
        pass

    def end_headers(self):
        # the studio is edited while it runs: never let the browser keep a stale module
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        parts = url.path.strip("/").split("/")
        if parts[:2] == ["api", "models"]:
            if len(parts) == 2:
                return self._json(json.loads((MODELS / "index.json").read_text()))
            p = MODELS / f"{parts[2]}.json"
            return self._json(json.loads(p.read_text())) if p.exists() else self._json({"error": "no model"}, 404)
        if parts[:2] == ["api", "photo"] and len(parts) == 3:
            fid = parts[2].removesuffix(".jpg")
            meta = None
            if q.get("model"):
                m = json.loads((MODELS / f"{q['model']}.json").read_text())
                meta = next((p for p in m.get("photos", []) if p["frame_id"] == fid), None)
            try:
                body = photo_view(fid, float(q["yaw"]) if "yaw" in q else None, float(q.get("pitch", 0)),
                                  float(q.get("hfov", 70)), int(q.get("w", 1280)), int(q.get("h", 960)), meta)
            except Exception as e:  # noqa: BLE001
                return self._json({"error": str(e)}, 500)
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        parts = urllib.parse.urlsplit(self.path).path.strip("/").split("/")
        if parts[:2] != ["api", "snap"] or len(parts) != 3 or not parts[2].replace("-", "").replace("_", "").isalnum():
            return self._json({"error": "not found"}, 404)
        from .config import OUT

        dest = OUT / "snaps"
        dest.mkdir(parents=True, exist_ok=True)
        f = dest / f"{parts[2]}.png"
        f.write_bytes(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        return self._json({"saved": str(f)})

    def do_PUT(self):  # noqa: N802
        parts = urllib.parse.urlsplit(self.path).path.strip("/").split("/")
        if parts[:2] != ["api", "models"] or len(parts) != 3:
            return self._json({"error": "not found"}, 404)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if body.get("schema") != "kerbfront.building/1" or body.get("id") != parts[2]:
            return self._json({"error": "not a kerbfront.building/1 model with this id"}, 400)
        dest = MODELS / f"{parts[2]}.json"
        if dest.exists():
            hist = MODELS / ".history"
            hist.mkdir(exist_ok=True)
            shutil.copy2(dest, hist / f"{parts[2]}.{time.strftime('%Y%m%d-%H%M%S')}.json")
        dest.write_text(json.dumps(body, indent=1))
        return self._json({"saved": str(dest.relative_to(LAB)), "edits": len(body.get("edits", []))})


def serve(port: int = 8791) -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"kerbfront studio on http://127.0.0.1:{port}/", flush=True)
    srv.serve_forever()
