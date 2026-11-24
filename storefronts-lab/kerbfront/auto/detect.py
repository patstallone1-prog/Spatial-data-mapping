"""Facade parts by open-vocabulary detection: Grounding DINO (IDEA-Research/grounding-dino-tiny)
prompted with the parts' names, run on the registered elevation itself.

The ADE20K parser calls an outdoor window "building" (its window class is mostly indoor
glazing), so it cannot find windows on a facade. A detector prompted with "window" finds
them, framed or not, on brick as on render, and the elevation's metric grid turns its boxes
straight into metres."""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np

from .segment import _hf_home

MODEL = "IDEA-Research/grounding-dino-tiny"
PROMPT = "window. door. awning. sign."
KINDS = ("window", "door", "awning", "sign")


@lru_cache(maxsize=1)
def _model():
    _hf_home()
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    return AutoProcessor.from_pretrained(MODEL), AutoModelForZeroShotObjectDetection.from_pretrained(MODEL).to(dev).eval(), dev


def detect(img_bgr: np.ndarray, scale: float = 2.0, threshold: float = 0.25, max_side: int = 2600) -> list[dict]:
    """Boxes in the image's own pixels: {kind, x0, y0, x1, y1, score}. Long elevations are
    read in overlapping windows (the detector works on a ~800 px short side)."""
    import torch
    from PIL import Image

    proc, model, dev = _model()
    k = min(scale, max_side / max(img_bgr.shape[:2]) * 3)
    im = cv2.resize(np.clip(img_bgr, 0, 255).astype(np.uint8), None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    H, W = im.shape[:2]
    step = max(H * 2, 600)
    xs = list(range(0, max(1, W - step) + 1, max(1, step * 2 // 3))) or [0]
    if xs[-1] + step < W:
        xs.append(W - step)
    out = []
    for x0 in xs:
        crop = im[:, x0:x0 + step]
        pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        inp = proc(images=pil, text=PROMPT, return_tensors="pt").to(dev)
        with torch.no_grad():
            o = model(**inp)
        res = proc.post_process_grounded_object_detection(o, inp.input_ids, threshold=threshold, text_threshold=0.2,
                                                          target_sizes=[pil.size[::-1]])[0]
        labs = res.get("text_labels", res.get("labels"))
        for b, lab, s in zip(res["boxes"].cpu().numpy(), labs, res["scores"].cpu().numpy()):
            kind = next((kk for kk in KINDS if kk in str(lab)), None)
            if kind is None:
                continue
            out.append({"kind": kind, "x0": (b[0] + x0) / k, "y0": b[1] / k, "x1": (b[2] + x0) / k, "y1": b[3] / k,
                        "score": float(s)})
    return _nms(out)


def _nms(boxes: list[dict], iou: float = 0.5) -> list[dict]:
    keep: list[dict] = []
    for b in sorted(boxes, key=lambda b: -b["score"]):
        if all(b["kind"] != k["kind"] or _iou(b, k) < iou for k in keep):
            keep.append(b)
    return keep


def _iou(a, b) -> float:
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    ua = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / ua if ua > 0 else 0.0
