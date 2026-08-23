"""Detecting when a photograph is *of* a person, so it never leaves the device.

This is a privacy filter, not a redaction step, and the distinction is the whole design. EgoBlur
blurs faces in imagery that is worth keeping. This decides that some imagery is not worth
keeping at all — a photograph whose subject is a person tells you nothing about a kerb, and
uploading it is a cost with no benefit and a real risk.

**What counts as "the main focus".** A bystander forty metres down the pavement is unavoidable
in street capture and is not what this is about. Three signals together decide it, and requiring
more than one keeps a distant pedestrian from tripping the filter:

* **Area** — how much of the frame the person occupies. A face filling a third of the image is a
  portrait; a figure two percent across is background.
* **Centrality** — a subject is framed near the centre. Someone at the edge is usually incidental.
* **Focus** — the subject is normally the sharpest thing present. A person sharper than their
  surroundings was what the camera was pointed at.

**Erring toward deletion is correct here.** Discarding a usable street frame costs one frame out
of thousands. Uploading a photograph of somebody's face costs something that cannot be undone,
and this is a network of cameras worn in public. So the thresholds are set to over-delete, and
the cost of that is measured in the curation report rather than argued about.

Detectors are OpenCV's bundled HOG people detector and Haar cascades: no downloaded weights, no
network, entirely on-device. They are dated and imperfect — modern detectors are far better —
but they are free, offline, and licence-clean, and for "is a person the subject" the bar is low.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True, slots=True)
class Detection:
    """One detected person or face, in pixel coordinates."""

    x: int
    y: int
    width: int
    height: int
    kind: str
    confidence: float = 1.0

    @property
    def area(self) -> int:
        return self.width * self.height

    def centre(self) -> tuple[float, float]:
        return (self.x + self.width / 2.0, self.y + self.height / 2.0)


@dataclass(frozen=True, slots=True)
class PeopleConfig:
    """Thresholds. Tuned to over-delete; see the module docstring."""

    #: Fraction of the frame a single detection must cover to count as the subject on area
    #: alone. A face this large is a portrait whatever else is true.
    dominant_area_fraction: float = 0.10
    #: Lower area bound for a detection that is *also* central and sharp.
    supporting_area_fraction: float = 0.03
    #: Distance from frame centre, as a fraction of the half-diagonal, to count as centred.
    central_radius_fraction: float = 0.45
    #: Combined people area above which a frame is a crowd scene rather than a street.
    crowd_area_fraction: float = 0.18
    #: Detect faces as well as bodies. Faces are what matters most and what HOG misses.
    detect_faces: bool = True
    #: Longest edge the detectors run on. Downscaling first is most of the speed.
    working_edge_px: int = 640
    #: Minimum HOG SVM margin for a body detection to count.
    #:
    #: HOG returns a confidence with every box and it is worth using: at zero, vertical
    #: structures like poles, doorways and sign posts are reported as people all day. Raising it
    #: trades a little recall on distant figures — who are incidental anyway and would not be
    #: flagged as the subject — for materially fewer false positives on street furniture.
    min_body_confidence: float = 0.6


@dataclass(frozen=True, slots=True)
class PeopleAssessment:
    detections: tuple[Detection, ...]
    frame_area: int
    people_area_fraction: float
    largest_area_fraction: float
    is_subject: bool
    reason: str = ""
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def count(self) -> int:
        return len(self.detections)

    @property
    def has_people(self) -> bool:
        return bool(self.detections)


def _prepare(image: np.ndarray, edge_px: int) -> tuple[np.ndarray, float]:
    """Grayscale and downscale for detection. Returns the image and the scale applied."""
    import cv2

    array = np.asarray(image)
    if array.ndim == 3:
        array = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    longest = max(array.shape[:2])
    scale = min(1.0, edge_px / longest) if longest else 1.0
    if scale < 1.0:
        array = cv2.resize(
            array, (round(array.shape[1] * scale), round(array.shape[0] * scale)),
            interpolation=cv2.INTER_AREA,
        )
    return array, scale


_CASCADES: dict[str, object] = {}


def _cascade(name: str):
    """Load and memoise a bundled cascade. Loading is slow; detection is not."""
    import cv2

    if name not in _CASCADES:
        path = cv2.data.haarcascades + name
        classifier = cv2.CascadeClassifier(path)
        if classifier.empty():
            raise RuntimeError(f"could not load cascade {name}")
        _CASCADES[name] = classifier
    return _CASCADES[name]


def detect_people(image: np.ndarray, config: PeopleConfig | None = None) -> list[Detection]:
    """Find people and faces. Union of a body detector and two face cascades."""
    import cv2

    config = config or PeopleConfig()
    gray, scale = _prepare(image, config.working_edge_px)
    inverse = 1.0 / scale if scale else 1.0
    found: list[Detection] = []

    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    boxes, weights = hog.detectMultiScale(gray, winStride=(8, 8), padding=(8, 8), scale=1.06)
    for (x, y, w, h), weight in zip(boxes, weights, strict=False):
        if float(weight) < config.min_body_confidence:
            continue
        found.append(
            Detection(
                int(x * inverse), int(y * inverse), int(w * inverse), int(h * inverse),
                "body", float(weight),
            )
        )

    if config.detect_faces:
        for name, kind in (
            ("haarcascade_frontalface_default.xml", "face"),
            ("haarcascade_profileface.xml", "face_profile"),
        ):
            faces = _cascade(name).detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
            for x, y, w, h in faces:
                found.append(
                    Detection(
                        int(x * inverse), int(y * inverse), int(w * inverse), int(h * inverse),
                        kind, 1.0,
                    )
                )

    return found


def assess_people(
    image: np.ndarray,
    config: PeopleConfig | None = None,
    *,
    sharpness_of: float | None = None,
) -> PeopleAssessment:
    """Decide whether a person is the subject of this frame.

    ``sharpness_of`` is the frame's overall sharpness, used only to skip the work on frames that
    are being discarded anyway.
    """
    config = config or PeopleConfig()
    array = np.asarray(image)
    height, width = array.shape[:2]
    frame_area = max(height * width, 1)

    detections = detect_people(array, config)
    if not detections:
        return PeopleAssessment((), frame_area, 0.0, 0.0, False, "no people detected")

    # Union area via a coverage mask, so overlapping body and face boxes are not double counted.
    mask = np.zeros((height, width), dtype=bool)
    for d in detections:
        y0, y1 = max(0, d.y), min(height, d.y + d.height)
        x0, x1 = max(0, d.x), min(width, d.x + d.width)
        mask[y0:y1, x0:x1] = True
    people_fraction = float(mask.mean())

    largest = max(detections, key=lambda d: d.area)
    largest_fraction = largest.area / frame_area

    centre = np.array([width / 2.0, height / 2.0])
    half_diagonal = float(np.hypot(width, height)) / 2.0
    offset = float(np.linalg.norm(np.array(largest.centre()) - centre)) / max(half_diagonal, 1e-9)
    is_central = offset <= config.central_radius_fraction

    flags: list[str] = []
    if largest_fraction >= config.dominant_area_fraction:
        return PeopleAssessment(
            tuple(detections), frame_area, people_fraction, largest_fraction, True,
            f"{largest.kind} covers {largest_fraction:.0%} of the frame",
            ("person_is_subject",),
        )
    if people_fraction >= config.crowd_area_fraction:
        return PeopleAssessment(
            tuple(detections), frame_area, people_fraction, largest_fraction, True,
            f"{len(detections)} people cover {people_fraction:.0%} of the frame",
            ("crowd_scene",),
        )
    if largest_fraction >= config.supporting_area_fraction and is_central:
        return PeopleAssessment(
            tuple(detections), frame_area, people_fraction, largest_fraction, True,
            f"centred {largest.kind} covering {largest_fraction:.0%}",
            ("person_is_subject", "centred"),
        )

    flags.append("people_present_incidental")
    return PeopleAssessment(
        tuple(detections), frame_area, people_fraction, largest_fraction, False,
        f"{len(detections)} incidental, largest {largest_fraction:.1%} of frame",
        tuple(flags),
    )
