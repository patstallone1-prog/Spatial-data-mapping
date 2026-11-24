"""Stack rectified photos of one wall above the studio's square-on render of the same wall.

    python -m kerbfront stack tacolicious --wall 3 --photos 0 1 --snap tacolicious-w3

The studio saves the render (``studio.wallView(3); studio.snap('tacolicious-w3')``) framed exactly
like ``kerbfront rectify`` (u from -2 to L+2, v from height+1 down to -0.6), so the rows line up
metre for metre and differences read straight off the 1 m grid.
"""

from __future__ import annotations

import json

import cv2
import numpy as np

from ..config import LAB, OUT
from .rectify import rectify


def stack(model_id: str, edge: int, photos: list[int], snap: str | None = None, px_per_m: int = 40,
          urange: tuple[float, float] | None = None) -> str:
    model = json.loads((LAB / "models" / f"{model_id}.json").read_text())
    rows = []
    for i in photos:
        img = rectify(model, model["photos"][i], edge, px_per_m, urange=urange)
        cv2.putText(img, f"photo {i}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        rows.append(img)
    if snap:
        r = cv2.imread(str(OUT / "snaps" / f"{snap}.png"))
        if r is not None and rows:
            r = cv2.resize(r, (rows[0].shape[1], rows[0].shape[0]), interpolation=cv2.INTER_AREA)
            for u in range(int(np.ceil(-2)), int(r.shape[1] / px_per_m)):
                x = int((u + 2) * px_per_m) if not urange else int((u - urange[0]) * px_per_m)
                cv2.line(r, (x, 0), (x, 6), (0, 160, 160), 1)
            cv2.putText(r, "model", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
            rows.append(r)
    out = OUT / "stacks"
    out.mkdir(parents=True, exist_ok=True)
    f = out / f"{model_id}-w{edge}.jpg"
    cv2.imwrite(str(f), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return str(f)
