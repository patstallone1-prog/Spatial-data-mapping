"""Wall cladding by CLIP zero-shot (openai/clip-vit-base-patch32, the model the app's
``scripts/build_facade_photo_materials.py`` uses), with the classes that reading lacked:

* **fabric** -- a canvas awning, a shade sail, a market umbrella. The app's reader had no such
  class, so an awning filling a crop came out as wood or vinyl siding of the awning's colour.
* **smeared** -- a motion-blurred, dark or stretched crop, which says nothing about cladding.

Either answer means "no cladding read here": the caller keeps what it had.
"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np

from .segment import _hf_home

MODEL = "openai/clip-vit-base-patch32"
PROMPTS = {
    "stucco": ["a photo of a house wall of smooth painted stucco", "a photo of a plastered render facade"],
    "wood_siding": ["a photo of a house wall of horizontal wooden clapboard siding",
                    "a photo of a painted wooden siding facade"],
    "vinyl_siding": ["a photo of a house wall with vinyl siding", "a photo of a facade clad in plastic lap siding"],
    "brick": ["a photo of a red brick wall", "a photo of an exposed brick facade"],
    "painted_brick": ["a photo of a painted brick wall", "a photo of a facade of brick painted over"],
    "stone": ["a photo of a stone masonry wall", "a photo of a facade of cut stone blocks"],
    "concrete": ["a photo of a bare concrete wall", "a photo of a concrete facade"],
    "ceramic_tile": ["a photo of a facade covered in ceramic tiles"],
    "metal_panel": ["a photo of a facade clad in metal panels"],
    "glass": ["a photo of a glass shopfront", "a photo of a glass curtain wall office facade"],
    # reject classes
    "fabric": ["a photo of a striped canvas awning", "a photo of a fabric awning over a shopfront",
               "a photo of a canvas shade sail", "a photo of a market umbrella"],
    "smeared": ["a motion blurred photo", "a smeared, stretched, distorted photo", "a very dark photo"],
}
REJECT = {"fabric", "smeared"}
#: the studio's materials
TO_MODEL = {"stucco": "stucco", "concrete": "concrete", "brick": "brick", "painted_brick": "brick",
            "wood_siding": "wood_siding", "vinyl_siding": "wood_siding", "stone": "stone",
            "ceramic_tile": "ceramic_tile", "metal_panel": "metal_panel", "glass": "glass", "fabric": "canvas"}


@lru_cache(maxsize=1)
def _model():
    _hf_home()
    import torch
    from transformers import CLIPModel, CLIPProcessor

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = CLIPModel.from_pretrained(MODEL).to(dev).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    classes = list(PROMPTS)
    sentences = [s for c in classes for s in PROMPTS[c]]
    owner = [c for c in classes for _ in PROMPTS[c]]
    with torch.no_grad():
        text = proc(text=sentences, return_tensors="pt", padding=True).to(dev)
        t = model.text_projection(model.text_model(**text).pooler_output)
        t = t / t.norm(dim=-1, keepdim=True)
        ct = torch.stack([t[[i for i, o in enumerate(owner) if o == c]].mean(0) for c in classes])
        ct = ct / ct.norm(dim=-1, keepdim=True)
    return model, proc, dev, classes, ct


def probs(crops: list[np.ndarray]) -> list[dict[str, float]]:
    import torch
    from PIL import Image

    model, proc, dev, classes, ct = _model()
    ims = [Image.fromarray(cv2.cvtColor(np.clip(c, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)) for c in crops]
    with torch.no_grad():
        px = proc(images=ims, return_tensors="pt").to(dev)
        v = model.visual_projection(model.vision_model(pixel_values=px["pixel_values"]).pooler_output)
        v = v / v.norm(dim=-1, keepdim=True)
        p = (100.0 * v @ ct.T).softmax(dim=-1).cpu().numpy()
    return [{c: float(x) for c, x in zip(classes, row)} for row in p]


def classify(img_bgr: np.ndarray, tile_px: int | None = None) -> tuple[str | None, dict]:
    """Square tiles across the crop, probabilities averaged. Returns the model's material
    name (or None when the answer is a reject class or too unsure) and the averaged probs."""
    h, w = img_bgr.shape[:2]
    side = tile_px or max(32, min(h, w))
    tiles = [img_bgr[0:side, x:x + side] for x in range(0, max(1, w - side + 1), max(1, side // 2))]
    tiles = [t for t in tiles if t.shape[0] >= 24 and t.shape[1] >= 24 and (t.max(axis=2) > 12).mean() > 0.7]
    if not tiles:
        return None, {}
    ps = probs(tiles)
    avg = {c: float(np.mean([p[c] for p in ps])) for c in ps[0]}
    ranked = sorted(avg.items(), key=lambda kv: -kv[1])
    best, p1 = ranked[0]
    p2 = ranked[1][1]
    info = {"probs": {k: round(v, 3) for k, v in ranked[:4]}, "tiles": len(tiles)}
    if best in REJECT:
        info["rejected"] = best
        return None, info
    if p1 < 0.3 or p1 - p2 < 0.05:
        info["unsure"] = True
        return None, info
    return TO_MODEL.get(best, best), info
