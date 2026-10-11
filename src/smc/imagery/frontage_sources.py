"""One pixel-adapter boundary, with explicit production-ineligible datasets."""

from __future__ import annotations

from smc.imagery.http import HttpClient

RESTRICTED_DATASETS = {
    "sf-xl": "StreetView crops; dataset rights not approved; Google imagery excluded",
    "3d-street-view": "Google imagery; non-commercial derivatives; manual reference mesh",
    "3d_street_view": "Google imagery; non-commercial derivatives; manual reference mesh",
}
SUPPORTED_PROVIDERS = ("mapillary", "kartaview", "panoramax", "pandaset")


def source_block_reason(provider: str) -> str | None:
    normalized = provider.lower().replace("_", "-")
    return RESTRICTED_DATASETS.get(normalized)


def provider_for(name: str, instance: str):
    if source_block_reason(name):
        raise ValueError("source restricted: " + source_block_reason(name))
    if name == "mapillary":
        from smc.imagery.mapillary import MapillaryProvider
        return MapillaryProvider()
    if name == "kartaview":
        from smc.imagery.kartaview import KartaViewProvider
        return KartaViewProvider()
    if name == "panoramax":
        from smc.imagery.panoramax import PanoramaxProvider
        # Old catalogues keep the host, whereas newer ones may contain an API URL.
        endpoint = instance if instance.startswith("https://") else f"https://{instance}/api"
        return PanoramaxProvider(endpoint=endpoint)
    if name == "pandaset":
        from smc.imagery.pandaset import PandaSetProvider
        return PandaSetProvider()
    raise ValueError("no verified pixel adapter for this provider")


def read_source_pixels(provider, observation) -> bytes:
    """An archive member is not an HTTP URL with a fragment attached."""
    if provider.name == "pandaset":
        return provider.read_pixels(observation)
    return HttpClient(max_attempts=2).fetch(provider.resolve_image(observation).url)
