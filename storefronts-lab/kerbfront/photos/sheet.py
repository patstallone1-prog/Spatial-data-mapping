"""A photo-versus-model contact sheet: each row is a Mapillary view (re-projected by the studio's
photo server) beside the studio's render from the same camera (saved with ``studio.snap``).

    sheet([("a16", url)])   # url: the studio's ``studio.photoUrl()`` after ``studio.snap("sheet-a16")``
"""

from __future__ import annotations

import urllib.request

import cv2
import numpy as np

from ..config import OUT


def sheet(pairs: list[tuple[str, str]], dest: str = "five-restaurants.jpg", w: int = 640, h: int = 480) -> str:
    """``pairs``: (model id, photo URL the studio showed); renders are read from out/snaps/sheet-<id>.png."""
    rows = []
    for mid, url in pairs:
        ph = cv2.imdecode(np.frombuffer(urllib.request.urlopen(url).read(), np.uint8), cv2.IMREAD_COLOR)
        r = cv2.imread(str(OUT / "snaps" / f"sheet-{mid}.png"))
        row = np.hstack([cv2.resize(ph, (w, h)), np.full((h, 8, 3), 255, np.uint8), cv2.resize(r, (w, h))])
        cv2.putText(row, f"{mid}: Mapillary photo (CC BY-SA)", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(row, "kerbfront model, same camera", (w + 18, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (20, 20, 20), 2)
        rows += [row, np.full((8, row.shape[1], 3), 255, np.uint8)]
    f = OUT / dest
    cv2.imwrite(str(f), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
    return str(f)
