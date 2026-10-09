"""Pinned upstream object detector: private image proposals, never measured truth."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

MODEL = "IDEA-Research/grounding-dino-tiny"
REVISION = "a2bb814dd30d776dcf7e30523b00659f4f141c71"
WEIGHTS_SHA256 = "1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3"
PROMPT = "window. door. garage door. stairs. fire escape. balcony. canopy."


class FacadeDetailDetector:
    def __init__(self, cache: Path):
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
        torch.set_num_threads(2)
        self.processor = AutoProcessor.from_pretrained(snapshot, local_files_only=True)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(
            snapshot,
            local_files_only=True,
            use_safetensors=True,
        ).eval()
        self.manifest = {
            "model": MODEL,
            "revision": REVISION,
            "weights_sha256": digest,
            "license": "Apache-2.0",
            "prompt": PROMPT,
            "model_card": f"https://huggingface.co/{MODEL}",
            "grade": "uncalibrated_detection_proposal_not_geometry_truth",
        }

    def detect(self, bgr: np.ndarray) -> dict:
        import torch

        inputs = self.processor(images=bgr[..., ::-1].copy(), text=PROMPT, return_tensors="pt")
        with torch.inference_mode():
            output = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            output,
            inputs.input_ids,
            threshold=0.30,
            text_threshold=0.25,
            target_sizes=[bgr.shape[:2]],
        )[0]
        h, w = bgr.shape[:2]
        return {
            "model": self.manifest,
            "objects": [
                {
                    "kind": label,
                    "score": float(score),
                    "box": [float(x0 / w), float(y0 / h), float(x1 / w), float(y1 / h)],
                    "review_status": "needs_object_identity_and_geometry_review",
                }
                for box, label, score in zip(
                    result["boxes"].tolist(),
                    result["text_labels"],
                    result["scores"].tolist(),
                    strict=True,
                )
                for x0, y0, x1, y1 in [box]
            ],
        }
