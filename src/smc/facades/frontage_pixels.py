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


#: Model classes that mark the way in. A door alone is enough; steps or a porch canopy only
#: with a door or railing beside them, so a stair-like shadow is not an entrance.
DOOR = {"door", "screen door"}
APPROACH = {"stairs", "stairway", "step", "awning", "canopy", "railing", "bannister"}
#: Kinds of detail a house is told apart by. Counted once each, however large.
FEATURES = {
    "windowpane": {"windowpane", "window"},
    "door": DOOR,
    "steps": {"stairs", "stairway", "step"},
    "railing": {"railing", "bannister", "balustrade"},
    "awning": {"awning", "canopy"},
    "column": {"column"},
    "fence": {"fence"},
    "lamp": {"lamp", "sconce", "light"},
    "sign": {"signboard", "trade name", "poster"},
}
#: A class must cover this much of the visible front to count as present.
PRESENT = 0.003
#: Below this rectilinearity the crop is not squared up: its verticals lean, the pose is off.
MIN_SQUARENESS = 0.30


def _name(label: str) -> str:
    return str(label).lower().split(",")[0].strip()


def detail_measures(labels: np.ndarray, visible: np.ndarray, names: dict[int, str]) -> dict:
    """Entrance and distinct-feature evidence in a squared-up front, from the model's labels."""
    total = max(1, int(visible.sum()))
    lower = np.zeros_like(visible)
    lower[labels.shape[0] * 11 // 20 :] = True  # the ground floor: the bottom 45 per cent
    lower &= visible
    lower_total = max(1, int(lower.sum()))

    def ids(members):
        return [i for i, label in names.items() if _name(label) in members]

    present = {
        kind: float((np.isin(labels, ids(members)) & visible).sum() / total)
        for kind, members in FEATURES.items()
    }
    door_low = float((np.isin(labels, ids(DOOR)) & lower).sum() / lower_total)
    approach_low = float((np.isin(labels, ids(APPROACH)) & lower).sum() / lower_total)
    openings = (np.isin(labels, ids(FEATURES["windowpane"] | DOOR)) & visible).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(openings, connectivity=8)
    blob = max(12, total // 2000)
    opening_count = int((stats[1:, cv2.CC_STAT_AREA] >= blob).sum()) if count > 1 else 0
    kinds = sorted(k for k, v in present.items() if v >= PRESENT)
    return {
        "entrance_detected": bool(
            door_low >= 0.004 or (approach_low >= 0.006 and (door_low > 0.001 or "railing" in kinds))
        ),
        "door_ground_floor_fraction": round(door_low, 5),
        "approach_ground_floor_fraction": round(approach_low, 5),
        "feature_kinds": kinds,
        "opening_count": opening_count,
        "feature_fractions": {k: round(v, 5) for k, v in present.items()},
    }


def view_gate(details: dict, candidate: dict, rectilinearity: float | None) -> list[str]:
    """What the pixels must show for this particular view to be kept.

    A view steeper than the square-on limit is kept only for its entrance; every view must show
    at least one opening (a blank wall or a hedge is no likeness), and must come out square.
    """
    reasons = []
    if candidate.get("needs_entrance") and not details.get("entrance_detected"):
        reasons.append("oblique_without_entrance")
    if details.get("opening_count", 0) == 0:
        reasons.append("no_detectable_openings")
    if rectilinearity is not None and rectilinearity < MIN_SQUARENESS:
        reasons.append("not_squared_up")
    return reasons


class FrontagePixelScreen:
    def __init__(self, cache: Path, device: str = "cpu"):
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
        if device == "auto":
            device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if torch.backends.mps.is_available()
                else "cpu"
            )
        if device not in {"cpu", "mps", "cuda"}:
            raise ValueError("unsupported screen device")
        self.device = device
        self.manifest["device"] = device
        if self.manifest["files"].get("model.safetensors") != WEIGHTS_SHA256:
            raise ValueError("pinned semantic model checksum mismatch")
        torch.set_num_threads(2)
        self.processor = AutoImageProcessor.from_pretrained(snapshot, local_files_only=True)
        self.model = (
            UperNetForSemanticSegmentation.from_pretrained(
                snapshot, local_files_only=True, use_safetensors=True
            )
            .eval()
            .to(device)
        )
        if device == "mps":
            # UperNet's 3/6-bin adaptive pools are unsupported for non-divisible
            # MPS dimensions. Execute those exact pooling operations on CPU,
            # then return to the GPU; do not resize evidence to dodge the error.
            class ExactAdaptivePool(torch.nn.AdaptiveAvgPool2d):
                def forward(self, value):
                    return super().forward(value.cpu()).to(value.device)

            for module in self.model.modules():
                for name, child in list(module.named_children()):
                    if isinstance(child, torch.nn.AdaptiveAvgPool2d):
                        replacement = ExactAdaptivePool(child.output_size)
                        setattr(module, name, replacement)
                        # Upstream UperNet also executes a plain list of these
                        # registered children; keep that alias in sync.
                        if isinstance(getattr(module, "layers", None), list):
                            module.layers = [
                                replacement if layer is child else layer for layer in module.layers
                            ]
            self.manifest["runtime_adapter"] = "exact_cpu_adaptive_pool_only; full_encoder_gpu"
        self.labels = {
            int(i): str(label).lower() for i, label in self.model.config.id2label.items()
        }

    def screen(self, bgr: np.ndarray, visible: np.ndarray) -> dict:
        import torch

        rgb = bgr[..., ::-1].copy()
        inputs = self.processor(images=rgb, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            logits = self.model(**inputs).logits
            logits = torch.nn.functional.interpolate(
                logits, size=bgr.shape[:2], mode="bilinear", align_corners=False
            )
            labels = logits.argmax(dim=1)[0].cpu().numpy()
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
            "details": detail_measures(labels, visible, self.labels),
            "sharpness_laplacian": sharpness,
            "model": self.manifest,
            "labels": labels,
        }
