"""The provider interface.

Everything above this line knows about observations and sequences. Nothing above it knows about
KartaView's paging or Panoramax's STAC links. Adding Mapillary later should mean writing one
file that satisfies this protocol and registering it -- and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Iterator

    from smc.imagery.region import Region
    from smc.imagery.schema import Observation, SequenceRecord


class ObservationUnavailable(RuntimeError):
    """The provider no longer serves this observation's pixels."""


@dataclass(frozen=True, slots=True)
class License:
    """What a provider requires of anyone using its imagery.

    Kept per-observation rather than per-provider because Panoramax is federated: two items in
    one search response can come from different instances under different licences, and
    flattening them into a single provider-level claim would be wrong the first time it mattered.
    """

    identifier: str
    url: str | None = None
    attribution: str | None = None
    #: Whether derivatives inherit the licence. Share-alike terms decide whether a measurement
    #: can enter a commercial database, so it is a field rather than a footnote.
    share_alike: bool = True


@dataclass(frozen=True, slots=True)
class ImageAsset:
    """A resolved, currently-valid way to fetch one observation's pixels."""

    url: str
    width: int | None = None
    height: int | None = None
    content_type: str | None = None
    #: ``hd`` or ``sd``. The catalogue prefers full resolution and downsamples locally, so that
    #: the pixel budget is applied once, by us, rather than differing per provider.
    role: str = "hd"


@runtime_checkable
class ImageryProvider(Protocol):
    """Metadata-first access to a street-imagery archive."""

    name: str
    instance: str

    def discover_sequences(self, region: Region) -> Iterator[SequenceRecord]:
        """Sequences with any presence in the region. Metadata only -- no pixels."""

    def get_sequence(self, sequence_id: str) -> SequenceRecord | None:
        """One sequence's metadata, by provider-native id."""

    def iter_observations(self, sequence_id: str) -> Iterator[Observation]:
        """Every frame of a sequence, in capture order. Metadata only -- no pixels."""

    def resolve_image(self, observation: Observation) -> ImageAsset:
        """Where this observation's pixels live *now*.

        Deliberately not a stored URL lookup. CDN addresses change, and a catalogue whose only
        route back to the source is a cached URL rots silently.
        """

    def get_license(self, observation: Observation | None = None) -> License:
        """The licence for one observation, or the provider's default when given none."""
