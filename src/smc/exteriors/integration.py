"""The map viewer's storefront hooks, now part of the viewer itself.

They were kept as a patch applied to build copies while the exteriors were under review; on
2026-10-31 the owner put them on the live site, so the hooks live in the authoritative viewer
(scripts/build_sf_corridor_3d.py) and the site's storefront manifest turns them on for the worlds
it covers (scripts/publish_store_exteriors.py). A page with none over its area loads nothing more.
"""

from __future__ import annotations

HOOKS = ("async function loadStoreExteriorBundle()", "function storeExteriorFor(feature)",
         "STORE_EXTERIOR_RUNTIME.renderer.mount(group,exteriorPlan,exteriorOrigin)")


def instrument_viewer(html: str) -> str:
    """The viewer, checked to carry the storefront hooks (it has them natively now)."""
    missing = [hook for hook in HOOKS if hook not in html]
    if missing:
        raise ValueError(f"viewer lacks the storefront hooks: {missing}")
    return html
