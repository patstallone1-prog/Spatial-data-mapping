"""What a photograph is actually of, as fractions of its own pixels.

The catalogue ranks frames by how many pixels they have. That says nothing about whether those
pixels are of a kerb, a bus, or the sky. Two frames of identical resolution taken ten metres
apart can be a clean view of a shopfront and the back of a lorry, and only one of them is worth
rectifying a facade out of.

Cityscapes' nineteen classes are what a street-level segmentation model is trained on, and they
map onto the questions this project asks: how much of this frame is road surface, how much is
footway, how much is the building line, and how much of it is something standing in the way.
The last of those is the one nothing else can supply -- occlusion is invisible to every other
signal in the catalogue and is the single commonest reason a frame that should be useful is not.
"""

from __future__ import annotations

import numpy as np

#: Cityscapes' training labels, in order. The model emits these indices.
CITYSCAPES_CLASSES = (
    "road", "sidewalk", "building", "wall", "fence", "pole", "traffic light",
    "traffic sign", "vegetation", "terrain", "sky", "person", "rider", "car",
    "truck", "bus", "train", "motorcycle", "bicycle",
)

#: The groupings this project cares about. A frame is described by how much of it is each.
GROUPS: dict[str, tuple[str, ...]] = {
    "road": ("road",),
    "sidewalk": ("sidewalk",),
    "facade": ("building", "wall", "fence"),
    "vegetation": ("vegetation", "terrain"),
    "sky": ("sky",),
    # Things between the camera and what it was pointed at. A parked van does not stop a frame
    # being a photograph; it stops it being a photograph of the building behind it.
    "vehicle_occlusion": ("car", "truck", "bus", "train", "motorcycle", "bicycle"),
    "person_occlusion": ("person", "rider"),
    # Poles and signs, which are both street furniture worth finding and thin occluders.
    "furniture": ("pole", "traffic light", "traffic sign"),
}

_INDEX = {name: i for i, name in enumerate(CITYSCAPES_CLASSES)}


def fractions(labels: np.ndarray) -> dict[str, float]:
    """Share of the frame in each group, from a map of Cityscapes class indices."""
    total = labels.size
    if not total:
        return {name: 0.0 for name in GROUPS}
    counts = np.bincount(labels.ravel(), minlength=len(CITYSCAPES_CLASSES))
    return {
        name: float(sum(counts[_INDEX[c]] for c in members if c in _INDEX) / total)
        for name, members in GROUPS.items()
    }


def usefulness(shares: dict[str, float]) -> dict[str, float]:
    """What each frame is good for, from what is in it. Each 0 to 1.

    Deliberately not one number. A frame that is nine tenths road surface is close to useless
    for a facade and is exactly what a road-marking pass wants, and averaging those into a
    single quality score is how the resolution tier came to stand in for value in the first
    place.
    """
    occlusion = shares.get("vehicle_occlusion", 0.0) + shares.get("person_occlusion", 0.0)
    clear = max(0.0, 1.0 - occlusion * 2.0)
    return {
        "facade_value": min(1.0, shares.get("facade", 0.0) * 2.0) * clear,
        "road_value": min(1.0, shares.get("road", 0.0) * 2.5) * clear,
        # A kerb is where the footway meets the road, so a frame needs both to show one.
        "kerb_value": min(1.0, min(shares.get("road", 0.0),
                                   shares.get("sidewalk", 0.0)) * 8.0) * clear,
        "occlusion": min(1.0, occlusion),
    }
