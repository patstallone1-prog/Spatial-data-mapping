"""Owned-label material classifier over externally computed, pinned DINOv2 embeddings."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np

from smc.reconstruction.contracts import FACADE_MATERIALS, GROUND_MATERIALS, ROOF_MATERIALS

MIN_REGIONS_PER_CLASS = 150
MATERIALS = {"facade": FACADE_MATERIALS, "ground": GROUND_MATERIALS, "roof": ROOF_MATERIALS}


@dataclass(frozen=True)
class LabelledRegion:
    region_id: str
    building_id: str
    block_id: str
    surface_group: str
    material: str
    embedding: np.ndarray
    image_source_id: str


@dataclass(frozen=True)
class MaterialPrediction:
    name: str
    probabilities: dict[str, float]
    confidence: float


class MaterialClassifier:
    def __init__(self, centroids: dict[str, np.ndarray], *, threshold: float = 0.70) -> None:
        self.centroids = centroids
        self.threshold = threshold

    @classmethod
    def fit(cls, labels: list[LabelledRegion], surface_group: str,
            *, min_regions: int = MIN_REGIONS_PER_CLASS) -> MaterialClassifier:
        if surface_group not in MATERIALS:
            raise ValueError("unknown surface group")
        groups: dict[str, list[np.ndarray]] = {}
        unique: dict[str, set[str]] = {}
        for label in labels:
            if label.surface_group != surface_group:
                continue
            if label.material not in MATERIALS[surface_group] or label.material == "unknown":
                raise ValueError(f"invalid {surface_group} label: {label.material}")
            if not label.image_source_id or not label.building_id or not label.block_id:
                raise ValueError("owned labels need source, building, and block identity")
            groups.setdefault(label.material, []).append(label.embedding)
            unique.setdefault(label.material, set()).add(label.region_id)
        centroids = {}
        for name, samples in groups.items():
            if len(unique[name]) < min_regions:
                continue
            array = np.stack(samples).astype(np.float64)
            if not np.isfinite(array).all() or array.ndim != 2:
                raise ValueError("non-finite material embedding")
            normalized = array / np.maximum(np.linalg.norm(array, axis=1, keepdims=True), 1e-9)
            centroid = normalized.mean(axis=0)
            centroids[name] = centroid / max(float(np.linalg.norm(centroid)), 1e-9)
        return cls(centroids)

    def predict(self, embedding: np.ndarray) -> MaterialPrediction:
        if not self.centroids:
            return MaterialPrediction("unknown", {"unknown": 1.0}, 0.0)
        vector = embedding.astype(np.float64)
        vector /= max(float(np.linalg.norm(vector)), 1e-9)
        names = sorted(self.centroids)
        similarity = np.array([float(vector @ self.centroids[name]) for name in names])
        likelihood = np.exp((similarity - similarity.max()) * 12.0)
        likelihood /= likelihood.sum()
        probabilities = {name: float(p) for name, p in zip(names, likelihood, strict=True)}
        best = int(np.argmax(likelihood))
        confidence = float(likelihood[best])
        if confidence < self.threshold:
            probabilities["unknown"] = 1.0 - confidence
            return MaterialPrediction("unknown", probabilities, confidence)
        return MaterialPrediction(names[best], probabilities, confidence)


def check_building_disjoint(train: list[LabelledRegion], test: list[LabelledRegion]) -> None:
    train_buildings = {item.building_id for item in train}
    train_blocks = {item.block_id for item in train}
    if train_buildings & {item.building_id for item in test}:
        raise ValueError("material benchmark leaks a building into training")
    if train_blocks & {item.block_id for item in test}:
        raise ValueError("material benchmark leaks a block into training")


def macro_f1(truth: list[str], predictions: list[str]) -> float:
    if len(truth) != len(predictions) or not truth:
        raise ValueError("material benchmark needs aligned, nonempty labels")
    classes = set(truth) | set(predictions)
    scores = []
    for name in classes:
        tp = sum(a == name and b == name for a, b in zip(truth, predictions, strict=True))
        fp = sum(a != name and b == name for a, b in zip(truth, predictions, strict=True))
        fn = sum(a == name and b != name for a, b in zip(truth, predictions, strict=True))
        scores.append(2.0 * tp / max(2 * tp + fp + fn, 1))
    return sum(scores) / len(scores)


def label_counts(labels: list[LabelledRegion]) -> dict[str, int]:
    return dict(Counter(label.material for label in labels))
