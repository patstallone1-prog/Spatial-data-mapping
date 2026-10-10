"""Pinned upstream object detector: private image proposals, never measured truth."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

MODEL = "IDEA-Research/grounding-dino-tiny"
REVISION = "a2bb814dd30d776dcf7e30523b00659f4f141c71"
WEIGHTS_SHA256 = "1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3"
PROMPT = "window. door. garage door. stairs. fire escape. balcony. canopy."
DETECTION_THRESHOLD = 0.20
ENTRANCE_PROMPT = "garage door. entrance door. entrance gate."


def remap_ground_proposals(objects: list[dict], top: int, height: int) -> list[dict]:
    """Map a focused ground-floor pass back to the same source; not extra evidence."""
    result = []
    for item in objects:
        label = item["kind"].lower()
        kind = (
            "garage door"
            if "garage" in label
            else "gated_entry_candidate"
            if "gate" in label
            else "door"
            if "door" in label
            else None
        )
        if kind is None:
            continue
        x0, y0, x1, y1 = item["box"]
        if not all(np.isfinite(v) for v in (x0, y0, x1, y1)):
            continue
        result.append(
            {
                **item,
                "kind": kind,
                "source_label": label,
                "identity_ambiguous": label
                not in {"garage door", "entrance door", "entrance gate"},
                "box": [
                    max(0.0, x0),
                    (top + max(0.0, y0) * (height - top)) / height,
                    min(1.0, x1),
                    (top + min(1.0, y1) * (height - top)) / height,
                ],
                "source_crop": "ground_floor_focus_same_pixels_not_independent_view",
            }
        )
    return result


def decoded_objects(result: dict, shape: tuple) -> list[dict]:
    """Validate upstream pairing; empty detections need no tokenizer labels.

    Some tokenizer versions decode an empty batch as one empty string. Do not
    truncate genuinely mismatched nonempty outputs to hide a detector failure.
    """
    boxes = result["boxes"].tolist()
    scores = result["scores"].tolist()
    labels = result["text_labels"]
    if not boxes and not scores:
        return []
    if not len(boxes) == len(scores) == len(labels):
        raise ValueError("nonempty_detector_output_length_mismatch")
    h, w = shape[:2]
    return [
        {
            "kind": label,
            "score": float(score),
            "box": [float(x0 / w), float(y0 / h), float(x1 / w), float(y1 / h)],
            "review_status": "needs_object_identity_and_geometry_review",
        }
        for box, label, score in zip(boxes, labels, scores, strict=True)
        for x0, y0, x1, y1 in [box]
    ]


class FacadeDetailDetector:
    def __init__(self, cache: Path, device: str = "cpu"):
        import torch
        from huggingface_hub import snapshot_download
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        snapshot = Path(
            snapshot_download(
                MODEL,
                revision=REVISION,
                cache_dir=cache,
                allow_patterns=["*.json", "*.txt", "README.md", "model.safetensors"],
            )
        )
        digest = hashlib.sha256((snapshot / "model.safetensors").read_bytes()).hexdigest()
        if digest != WEIGHTS_SHA256:
            raise ValueError("facade detector weights checksum mismatch")
        if device == "auto":
            device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if torch.backends.mps.is_available()
                else "cpu"
            )
        if device not in {"cpu", "mps", "cuda"}:
            raise ValueError("unsupported detector device")
        self.device = device
        torch.set_num_threads(2)
        self.processor = AutoProcessor.from_pretrained(snapshot, local_files_only=True)
        self.model = (
            AutoModelForZeroShotObjectDetection.from_pretrained(
                snapshot,
                local_files_only=True,
                use_safetensors=True,
            )
            .eval()
            .to(device)
        )
        self.manifest = {
            "model": MODEL,
            "revision": REVISION,
            "weights_sha256": digest,
            "license": "Apache-2.0",
            "prompt": PROMPT,
            "model_card": f"https://huggingface.co/{MODEL}",
            "grade": "uncalibrated_detection_proposal_not_geometry_truth",
            "device": device,
            "detection_threshold": DETECTION_THRESHOLD,
            "entrance_retry_prompt": ENTRANCE_PROMPT,
            "entrance_retry_top_fraction": 0.6,
        }

    def detect(self, bgr: np.ndarray, prompt: str = PROMPT) -> dict:
        import torch

        inputs = self.processor(images=bgr[..., ::-1].copy(), text=prompt, return_tensors="pt").to(
            self.device
        )
        with torch.inference_mode():
            output = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            output,
            inputs.input_ids,
            threshold=DETECTION_THRESHOLD,
            text_threshold=0.25,
            target_sizes=[bgr.shape[:2]],
        )[0]
        return {
            "model": self.manifest,
            "objects": decoded_objects(result, bgr.shape),
        }

    def detect_front(self, bgr: np.ndarray) -> dict:
        result = self.detect(bgr)
        top = int(bgr.shape[0] * 0.6)
        focused = self.detect(bgr[top:], ENTRANCE_PROMPT)
        result["objects"].extend(remap_ground_proposals(focused["objects"], top, bgr.shape[0]))
        result["passes"] = 2
        return result
