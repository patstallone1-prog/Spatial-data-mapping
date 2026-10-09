"""Pixel-level screening using a pinned existing semantic model, not invented geometry.

UperNet/ConvNeXt-tiny is published with MIT model-card licensing. Model decisions
remain inferred; no detector certifies privacy, address identity, or measured geometry.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import cv2
import numpy as np

MODEL = "openmmlab/upernet-convnext-tiny"
REVISION = "876ffc56b819a829448f7e81e9f8606deef6fb65"
MODEL_LICENSE = "MIT"
WEIGHTS_SHA256 = "cd55b1d36c6602d34f8cd300d7f788ea0fa5c3ed928e9ac98f353ecb31c7fa1d"


def semantic_gate(fractions: dict[str, float]) -> list[str]:
    if any(
        not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1
        for v in fractions.values()
    ):
        return ["invalid_semantics"]
    reasons = []
    if fractions.get("architecture", 0) < 0.60:
        reasons.append("too_little_facade")
    if fractions.get("sky", 0) > 0.20:
        reasons.append("sky_not_facade")
    if fractions.get("vegetation", 0) > 0.25:
        reasons.append("vegetation_blocks_detail")
    if fractions.get("dynamic", 0) > 0.10:
        reasons.append("people_or_vehicles_block_detail")
    if fractions.get("ground", 0) > 0.20:
        reasons.append("ground_not_facade")
    return reasons


class FrontagePixelScreen:
    def __init__(self, cache: Path):
        import torch
        from huggingface_hub import snapshot_download
        from transformers import AutoImageProcessor, UperNetForSemanticSegmentation

        snapshot = Path(
            snapshot_download(
                MODEL,
                revision=REVISION,
                cache_dir=cache,
                allow_patterns=[
                    "config.json",
                    "preprocessor_config.json",
                    "model.safetensors",
                    "README.md",
                ],
            )
        )
        self.manifest = {
            "model": MODEL,
            "revision": REVISION,
            "license": MODEL_LICENSE,
            "files": {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in snapshot.iterdir()
                if p.is_file()
            },
            "purpose": "inferred private selection; not privacy certification",
            "model_card": f"https://huggingface.co/{MODEL}/blob/{REVISION}/README.md",
        }
        if self.manifest["files"].get("model.safetensors") != WEIGHTS_SHA256:
            raise ValueError("pinned semantic model checksum mismatch")
        torch.set_num_threads(2)
        self.processor = AutoImageProcessor.from_pretrained(snapshot, local_files_only=True)
        self.model = UperNetForSemanticSegmentation.from_pretrained(
            snapshot, local_files_only=True, use_safetensors=True
        ).eval()
        self.labels = {
            int(i): str(label).lower() for i, label in self.model.config.id2label.items()
        }

    def screen(self, bgr: np.ndarray, visible: np.ndarray) -> dict:
        import torch

        rgb = bgr[..., ::-1].copy()
        inputs = self.processor(images=rgb, return_tensors="pt")
        with torch.inference_mode():
            logits = self.model(**inputs).logits
            logits = torch.nn.functional.interpolate(
                logits, size=bgr.shape[:2], mode="bilinear", align_corners=False
            )
            labels = logits.argmax(dim=1)[0].numpy()
        groups = {
            "architecture": {"building", "house", "wall", "windowpane", "door"},
            "sky": {"sky"},
            "vegetation": {"tree", "plant", "palm", "grass"},
            "dynamic": {"person", "car", "bus", "truck", "bicycle", "minibike", "van"},
            "ground": {"road", "sidewalk", "earth", "path", "floor"},
        }
        fractions = {
            group: float(
                (
                    np.isin(labels, [i for i, label in self.labels.items() if label in members])
                    & visible
                ).sum()
                / max(1, visible.sum())
            )
            for group, members in groups.items()
        }
        # Preserve the predicted semantic mask separately; never alter photographic pixels.
        reasons = semantic_gate(fractions)
        grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(grey, cv2.CV_32F)[visible].var()) if visible.any() else 0.0
        if sharpness < 10:
            reasons.append("blur_or_no_detail")
        return {
            "pass": not reasons,
            "reasons": reasons,
            "fractions": fractions,
            "sharpness_laplacian": sharpness,
            "model": self.manifest,
            "labels": labels,
        }
