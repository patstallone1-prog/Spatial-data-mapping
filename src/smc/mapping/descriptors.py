"""Frame descriptors.

Production is **MegaLoc** — DINOv2-base with a SALAD aggregation head, state of the art across
visual place recognition, landmark retrieval, and visual localization on LaMAR. It is not here
yet: it needs weights, a licence check, and GPU inference.

:class:`TinyImageDescriptor` stands in. It is not a toy invented for the gap — downsampled
greyscale with per-descriptor normalisation is a real, published, weak baseline for place
recognition, and it has the properties the rest of the pipeline needs to be exercised: it is
deterministic, view-sensitive, and cheap. It is also genuinely bad at the thing that matters,
being fooled by lighting and by any two facades of similar layout, which is the honest reason
the interface exists rather than a hard-coded call.

Swapping it is one class. Nothing downstream knows which produced a vector.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class FrameDescriptor(Protocol):
    name: str
    dimension: int

    def describe(self, image: np.ndarray) -> np.ndarray: ...


class TinyImageDescriptor:
    """Downsampled greyscale, mean-centred and L2-normalised.

    Mean-centring before normalisation is what makes it survive a global brightness change; it
    does nothing for a shadow moving across a facade, which is exactly the failure MegaLoc is
    trained out of.
    """

    name = "tiny_image"

    def __init__(self, side: int = 16) -> None:
        if side < 4:
            raise ValueError("side must be at least 4")
        self._side = side

    @property
    def dimension(self) -> int:
        return self._side * self._side

    def describe(self, image: np.ndarray) -> np.ndarray:
        array = np.asarray(image, dtype=np.float64)
        if array.ndim == 3:
            # Rec. 601 luma; the green channel carries most of the structure.
            array = array @ np.array([0.299, 0.587, 0.114])
        if array.ndim != 2:
            raise ValueError(f"expected an image, got shape {np.asarray(image).shape}")

        height, width = array.shape
        if height < self._side or width < self._side:
            raise ValueError(f"image {height}x{width} is smaller than the {self._side}px grid")

        # Box-average into the grid rather than sampling, so a single bright pixel cannot
        # dominate a cell and make the descriptor jitter between adjacent viewpoints.
        y_edges = np.linspace(0, height, self._side + 1).astype(int)
        x_edges = np.linspace(0, width, self._side + 1).astype(int)
        grid = np.empty((self._side, self._side))
        for i in range(self._side):
            for j in range(self._side):
                grid[i, j] = array[y_edges[i] : y_edges[i + 1], x_edges[j] : x_edges[j + 1]].mean()

        flat = grid.reshape(-1)
        flat = flat - flat.mean()
        norm = float(np.linalg.norm(flat))
        if norm < 1e-9:
            # A featureless frame — fog, a wall, a lens cap. Return a vector that will match
            # nothing rather than one that matches everything.
            return np.zeros(self.dimension) + 1e-6
        return flat / norm


def build_descriptor(name: str = "auto") -> FrameDescriptor:
    """Select a global descriptor by name.

    ``auto`` prefers MegaLoc when PyTorch is installed and falls back to the tiny-image
    baseline otherwise. The fallback is loud in the logs rather than silent, because an index
    built with one model and queried with the other returns plausible nonsense — every
    similarity is low, nothing retrieves, and it looks like a coverage problem.
    """
    if name in ("auto", "megaloc"):
        from smc.mapping import megaloc

        if megaloc.available():
            return megaloc.MegaLocDescriptor()
        if name == "megaloc":
            raise RuntimeError(
                "MegaLoc needs PyTorch: install the 'learned' extra, or select 'tiny_image'"
            )
    return TinyImageDescriptor()
