"""MegaLoc — the production global descriptor.

DINOv2-base with a SALAD aggregation head, state of the art across visual place recognition,
landmark retrieval, and visual localization on LaMAR. 228.6 M parameters, 8448-dimensional
L2-normalised output.

**Why this replaces the tiny-image baseline, and why it was not urgent.** Isolating the anchoring
stages showed retrieval was never the bottleneck at pilot scale — a 118-reference index returned
the correct frame every time, even across a vantage change that local matching could not survive.
Tiny-image descriptors fail differently: not on the hard query, but on *scale*. At a few hundred
references, comparing downsampled greyscale works. At a hundred thousand, where a corridor of
similar-looking shopfronts is competing against every other corridor in the city, it does not,
and the failure is silent — a plausible wrong reference rather than no reference.

**Costs, stated plainly:**

* 8448 float32 dimensions is ~34 kB per reference. A 100k-reference index is ~3.4 GB in memory.
  Half-precision storage halves that at negligible recall cost, and is the default here.
* Inference is ~228 M parameters per frame. On Apple Silicon MPS this is tens of milliseconds;
  on CPU it is closer to a second. It runs at index-build time and once per query, never on the
  phone.
* Weights download from the Hugging Face Hub on first use. ``HUGGINGFACE_TOKEN`` is optional but
  raises the rate limit.

The model is loaded lazily so importing this module costs nothing, and the whole file is
optional: :class:`~smc.mapping.descriptors.TinyImageDescriptor` remains a working fallback if
PyTorch is absent.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: MegaLoc's training resolution. Feeding it something else works and costs accuracy.
INPUT_SIDE = 322

#: ImageNet normalisation, which the DINOv2 backbone expects.
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)


def available() -> bool:
    """Whether PyTorch is importable. Lets callers fall back without catching ImportError."""
    try:
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def best_device() -> str:
    """Pick the fastest available device.

    MPS before CPU on Apple Silicon: it is roughly an order of magnitude faster for this model,
    which is the difference between a survey pass indexing in minutes and in an hour.
    """
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@dataclass(frozen=True, slots=True)
class MegaLocConfig:
    device: str | None = None
    batch_size: int = 8
    #: Store descriptors as float16. Halves index memory for a negligible recall cost.
    half_precision: bool = True
    repository: str = "gmberton/MegaLoc"
    entry_point: str = "get_trained_model"


class MegaLocDescriptor:
    """A :class:`~smc.mapping.descriptors.FrameDescriptor` backed by MegaLoc."""

    name = "megaloc"

    def __init__(self, config: MegaLocConfig | None = None) -> None:
        if not available():
            raise RuntimeError(
                "MegaLoc needs PyTorch; install the 'learned' extra or use TinyImageDescriptor"
            )
        self._config = config or MegaLocConfig()
        self._model = None
        self._device: str | None = None

    @property
    def dimension(self) -> int:
        return 8448

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = self._config.device or best_device()
        return self._device

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        import torch

        model = torch.hub.load(
            self._config.repository, self._config.entry_point, trust_repo=True
        )
        model.eval()
        self._model = model.to(self.device)

    def _preprocess(self, images: list[np.ndarray]):
        """Resize, scale to [0, 1], and normalise. Batched to amortise the transfer."""
        import torch
        import torch.nn.functional as functional

        tensors = []
        for image in images:
            array = np.asarray(image, dtype=np.float32)
            if array.ndim == 2:
                array = np.repeat(array[:, :, None], 3, axis=2)
            tensor = torch.from_numpy(array[:, :, :3]).permute(2, 0, 1) / 255.0
            tensors.append(tensor)

        batch = torch.stack(
            [
                functional.interpolate(
                    t.unsqueeze(0), size=(INPUT_SIDE, INPUT_SIDE),
                    mode="bilinear", align_corners=False,
                ).squeeze(0)
                for t in tensors
            ]
        )
        mean = torch.tensor(_MEAN).view(1, 3, 1, 1)
        std = torch.tensor(_STD).view(1, 3, 1, 1)
        return ((batch - mean) / std).to(self.device)

    def describe(self, image: np.ndarray) -> np.ndarray:
        return self.describe_batch([image])[0]

    def describe_batch(self, images: list[np.ndarray]) -> np.ndarray:
        """Describe several frames at once. The only sensible way to index a survey pass."""
        import torch

        if not images:
            return np.zeros((0, self.dimension), dtype=np.float32)
        self._ensure_model()
        assert self._model is not None

        outputs: list[np.ndarray] = []
        for start in range(0, len(images), self._config.batch_size):
            chunk = images[start : start + self._config.batch_size]
            with torch.no_grad():
                descriptors = self._model(self._preprocess(chunk))
            outputs.append(descriptors.detach().cpu().numpy())

        stacked = np.vstack(outputs)
        # The model already L2-normalises; renormalising costs nothing and makes the contract
        # explicit for anything that swaps the model out later.
        norms = np.linalg.norm(stacked, axis=1, keepdims=True)
        stacked = stacked / np.maximum(norms, 1e-9)
        return stacked.astype(np.float16 if self._config.half_precision else np.float32)

    def index_bytes_per_reference(self) -> int:
        return self.dimension * (2 if self._config.half_precision else 4)
