"""Semantic labels for rectified elevations: UperNet/ConvNeXt-tiny on ADE20K, the model Kerbside's
frontage filter already pins (``smc.facades.frontage_pixels``), at the same revision.

Each registered view is labelled on its own and the labels are fused by vote, so a person or a
car standing in one frame does not become part of the wall."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from ..config import CACHE

MODEL = "openmmlab/upernet-convnext-tiny"
REVISION = "876ffc56b819a829448f7e81e9f8606deef6fb65"


def _hf_home() -> None:
    # the user-level cache is a symlink to an offload drive that is not always mounted
    if "HF_HOME" not in os.environ:
        link = Path.home() / ".cache" / "huggingface"
        if not link.resolve().exists():
            os.environ["HF_HOME"] = str(CACHE / "hf")


@lru_cache(maxsize=1)
def model():
    _hf_home()
    import torch
    from transformers import AutoImageProcessor, UperNetForSemanticSegmentation

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    m = UperNetForSemanticSegmentation.from_pretrained(MODEL, revision=REVISION).to(dev).eval()
    proc = AutoImageProcessor.from_pretrained(MODEL, revision=REVISION)
    return m, proc, dev


@lru_cache(maxsize=1)
def names() -> dict[str, int]:
    m, _, _ = model()
    return {v.strip(): int(k) for k, v in m.config.id2label.items()}


def ids(*labels: str) -> set[int]:
    n = names()
    return {n[x] for x in labels if x in n}


def label(img_bgr: np.ndarray, valid: np.ndarray | None = None, tile: int = 640) -> np.ndarray:
    """Per-pixel ADE20K class ids (int16); -1 where unseen. Long elevations are labelled in
    overlapping square tiles so nothing is squashed."""
    import torch

    m, proc, dev = model()
    H, W = img_bgr.shape[:2]
    rgb = cv2.cvtColor(np.clip(img_bgr, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    side = min(H, W, tile)
    # a running best class per pixel (not every class's score: a panorama crop would need GBs)
    best_p = np.zeros((H, W), np.float32)
    best_c = np.zeros((H, W), np.int16)
    xs = list(range(0, max(1, W - side) + 1, max(1, side // 2))) or [0]
    if xs[-1] + side < W:
        xs.append(W - side)
    ys = list(range(0, max(1, H - side) + 1, max(1, side // 2))) or [0]
    if ys[-1] + side < H:
        ys.append(H - side)
    for y in ys:
        for x in xs:
            crop = rgb[y:y + side, x:x + side]
            with torch.no_grad():
                # 576 px in: the stride-32 bottleneck is 18 cells, which the pyramid pooling
                # (1, 2, 3, 6) divides exactly -- MPS will not pool non-divisible sizes
                inp = proc(images=crop, size={"height": 576, "width": 576}, return_tensors="pt").to(dev)
                out = m(**inp).logits[0]
                out = torch.nn.functional.interpolate(out[None], size=crop.shape[:2], mode="bilinear", align_corners=False)[0]
                pr = out.softmax(0)
                pm, pc = pr.max(0)
                pm, pc = pm.float().cpu().numpy(), pc.cpu().numpy().astype(np.int16)
            bp = best_p[y:y + side, x:x + side]
            upd = pm > bp
            bp[upd] = pm[upd]
            best_c[y:y + side, x:x + side][upd] = pc[upd]
    lab = best_c
    if valid is not None:
        lab[~valid] = -1
    return lab


def label_source(img_bgr: np.ndarray, mx: np.ndarray, my: np.ndarray, valid: np.ndarray, spherical: bool,
                 max_side: int = 1600) -> tuple[np.ndarray, dict | None]:
    """Labels for a wall grid read in the *photograph's* own geometry, where the parser was
    trained (a rectified, fused elevation reads as one big "building"). ``mx``/``my`` map grid
    cells to source pixels; only the crop that covers the wall (with a margin, so planes out
    in the street can be read from the same labels) is labelled. Returns the grid labels and
    the labelled crop, for :func:`remap`."""
    h, w = img_bgr.shape[:2]
    if not valid.any():
        return np.full(mx.shape, -1, np.int16), None
    x = mx.copy()
    roll = 0
    if spherical:
        roll = int(w / 2 - np.median(x[valid]))
        x = (x + roll) % w
    xs, ys = x[valid], my[valid]
    x0, x1 = max(0, int(np.percentile(xs, 0.5)) - 160), min(w, int(np.percentile(xs, 99.5)) + 160)
    y0, y1 = max(0, int(np.percentile(ys, 0.5)) - 60), min(h, int(np.percentile(ys, 99.5)) + 200)
    src = np.roll(img_bgr, roll, axis=1) if roll else img_bgr
    crop = src[y0:y1, x0:x1]
    k = min(1.0, max_side / max(crop.shape[:2]))
    if k < 1:
        crop = cv2.resize(crop, (int(crop.shape[1] * k), int(crop.shape[0] * k)), interpolation=cv2.INTER_AREA)
    info = {"lab": label(crop), "x0": x0, "y0": y0, "k": k, "roll": roll, "w": w, "spherical": spherical}
    return remap(info, mx, my, valid), info


def remap(info: dict | None, mx: np.ndarray, my: np.ndarray, valid: np.ndarray) -> np.ndarray:
    out = np.full(mx.shape, -1, np.int16)
    if info is None:
        return out
    lab = info["lab"]
    x = (mx + info["roll"]) % info["w"] if info["spherical"] else mx
    lx = ((x - info["x0"]) * info["k"]).astype(np.float32)
    ly = ((my - info["y0"]) * info["k"]).astype(np.float32)
    ok = valid & (lx >= 0) & (ly >= 0) & (lx < lab.shape[1] - 1) & (ly < lab.shape[0] - 1)
    lx[~ok] = -1
    ly[~ok] = -1
    r = cv2.remap(lab.astype(np.float32), lx, ly, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=-1)
    out[ok] = r[ok].astype(np.int16)
    return out


def vote(labels: list[np.ndarray], n_classes: int = 150) -> np.ndarray:
    H, W = labels[0].shape
    counts = np.zeros((n_classes, H, W), np.uint8)
    for lab in labels:
        ok = lab >= 0
        cls = np.where(ok, lab, 0)
        np.add.at(counts, (cls[ok], *np.nonzero(ok)), 1)
    out = counts.argmax(0).astype(np.int16)
    out[counts.max(0) == 0] = -1
    return out
