"""Every external service this system can talk to, and what it needs to authenticate.

Run ``python -m smc.adapters check`` to see which are configured and which are missing.

Two flags carry the weight here. ``commercial_safe`` records whether a service's output may
appear in a database that is eventually sold; ``free_tier`` records whether it costs money.
They are independent, and conflating them is how a project ends up with a beautiful pipeline it
cannot ship. The Google services below are *free* and *not commercially safe*: Maps Platform
terms forbid using Maps Content to train or improve ML systems, forbid creating content based
on Maps Content, and forbid caching it. This internal build uses them by explicit decision;
every one of them has a commercial-safe alternative already wired behind the same interface, so
the swap is configuration rather than a rewrite. See docs/01-dependency-stack.md 0.1.
"""

from __future__ import annotations

import enum
import os
from dataclasses import dataclass


class Capability(enum.StrEnum):
    """What an adapter provides. One capability, many possible providers."""

    ANCHOR_IMAGERY = "anchor_imagery"
    VISUAL_POSITIONING = "visual_positioning"
    GEOCODING = "geocoding"
    ELEVATION = "elevation"
    BASEMAP_TILES = "basemap_tiles"
    ROUTING = "routing"
    METRIC_DEPTH = "metric_depth"
    SEGMENTATION = "segmentation"
    OCR = "ocr"
    REDACTION = "redaction"
    OBJECT_STORE = "object_store"
    QUEUE = "queue"
    DATABASE = "database"
    REFERENCE_GEOMETRY = "reference_geometry"
    GROUND_TRUTH_LABELS = "ground_truth_labels"
    RTK_CORRECTIONS = "rtk_corrections"


@dataclass(frozen=True, slots=True)
class Credential:
    """One secret or setting the operator has to supply."""

    env_var: str
    service: str
    capability: Capability
    purpose: str
    where_to_get: str
    commercial_safe: bool
    free_tier: str
    #: True when the system cannot run at all without it.
    required: bool = False
    #: False when the value is a plain setting (a URL, a region, a mountpoint name) that needs
    #: no account anywhere. Separating this from `required` is what makes the shopping list
    #: honest: several entries here look like credentials and are simply configuration.
    needs_signup: bool = True

    @property
    def is_set(self) -> bool:
        return bool(os.environ.get(self.env_var))


CREDENTIALS: tuple[Credential, ...] = (
    # --- Google. Free, powerful, and unusable in the commercial build. ---
    Credential(
        env_var="GOOGLE_MAPS_API_KEY",
        service="Google Maps Platform (Street View Static, Geocoding, Elevation, Tiles)",
        capability=Capability.ANCHOR_IMAGERY,
        purpose="Anchor imagery, geocoding, elevation, basemap tiles for the internal build.",
        where_to_get="console.cloud.google.com -> APIs & Services -> Credentials",
        commercial_safe=False,
        free_tier="$200/mo credit; Street View Static ~$7/1000 beyond it",
    ),
    Credential(
        env_var="GOOGLE_ARCORE_API_KEY",
        service="ARCore Geospatial API (VPS)",
        capability=Capability.VISUAL_POSITIONING,
        purpose="Sub-metre pose from a camera frame — solves anchoring outright, internally.",
        where_to_get="Google Cloud console, enable ARCore API",
        commercial_safe=False,
        free_tier="Free. 1,000 sessions/min or 100,000 requests/min per project",
    ),
    Credential(
        env_var="GOOGLE_CLOUD_PROJECT",
        service="Google Cloud (GCS, Pub/Sub, Cloud SQL, Vertex AI)",
        capability=Capability.OBJECT_STORE,
        purpose="Object storage for transient imagery, queue, Postgres/PostGIS, GPU inference.",
        where_to_get=(
            "console.cloud.google.com for the project id, then "
            "`gcloud auth application-default login`"
        ),
        commercial_safe=True,
        free_tier="5 GB GCS, 10 GB Pub/Sub, then metered",
    ),
    Credential(
        env_var="GOOGLE_APPLICATION_CREDENTIALS",
        service="Google Cloud service account",
        capability=Capability.OBJECT_STORE,
        purpose="Service-account JSON path for non-interactive auth.",
        where_to_get="IAM & Admin -> Service Accounts -> Keys",
        commercial_safe=True,
        free_tier="n/a",
    ),
    # --- Commercial-safe equivalents, already wired behind the same interfaces. ---
    Credential(
        env_var="SMC_ANCHOR_INDEX_URL",
        service="Owned anchoring index (MegaLoc descriptors + Overture footprints)",
        capability=Capability.VISUAL_POSITIONING,
        purpose=(
            "The commercial-safe replacement for ARCore VPS. Retrieval over an owned descriptor "
            "index, ALIKED+LightGlue matching, pose against building footprints. NOTE: the "
            "stack behind this is NOT BUILT — it is the critical-path module in "
            "docs/03-build-order.md, and no published method reaches sub-metre from "
            "crowdsourced RGB without Google's VPS. The stack behind it is now BUILT: see "
            "smc.mapping.anchoring. What remains is the learned front end - descriptors and "
            "feature matching - and the index itself. Setting this variable points at that "
            "index once it has been produced."
        ),
        where_to_get="Self-hosted. s3:// or gs:// path to the built index",
        commercial_safe=True,
        free_tier="Self-hosted; cost is GPU embedding time plus storage",
        needs_signup=False,
    ),
    Credential(
        env_var="MAPILLARY_ACCESS_TOKEN",
        service="Mapillary API v4",
        capability=Capability.ANCHOR_IMAGERY,
        purpose="Anchor imagery. The commercial-safe replacement for Street View.",
        where_to_get="mapillary.com/dashboard/developers -> register an application",
        commercial_safe=True,
        free_tier="Free for all uses. 60k/min entity, 10k/min search, 50k/day tiles",
        required=True,
    ),
    Credential(
        env_var="MAPTILER_API_KEY",
        service="MapTiler (optional basemap)",
        capability=Capability.BASEMAP_TILES,
        purpose="Hosted vector tiles. OpenFreeMap is the zero-key default; this is a fallback.",
        where_to_get="cloud.maptiler.com/account/keys",
        commercial_safe=True,
        free_tier="100k tile requests/mo",
    ),
    Credential(
        env_var="OVERTURE_S3_REGION",
        service="Overture Maps (AWS Open Data)",
        capability=Capability.REFERENCE_GEOMETRY,
        purpose="Building footprints and road centrelines as anchor references.",
        where_to_get="No key needed; set the region, e.g. us-west-2",
        commercial_safe=True,
        free_tier="Free. Buildings/transportation are ODbL — reference only, never merged",
        needs_signup=False,
    ),
    Credential(
        env_var="PROJECT_SIDEWALK_BASE_URL",
        service="Project Sidewalk API",
        capability=Capability.GROUND_TRUTH_LABELS,
        purpose="Independent human labels for scoring Tier A precision and recall.",
        where_to_get="No key; e.g. https://sidewalk-dc.cs.washington.edu",
        commercial_safe=True,
        free_tier="Free, open data",
        needs_signup=False,
    ),
    Credential(
        env_var="RTK2GO_MOUNTPOINT",
        service="RTK2go NTRIP caster",
        capability=Capability.RTK_CORRECTIONS,
        purpose="Free RTK corrections for the Tier 2 vehicle rig's ZED-F9P.",
        where_to_get="rtk2go.com:2101 — no rover registration; pick a base within 35-50 km",
        commercial_safe=True,
        free_tier="Free. 800+ community base stations",
        needs_signup=False,
    ),
    # --- Model weights and hosted inference. ---
    Credential(
        env_var="HUGGINGFACE_TOKEN",
        service="Hugging Face Hub",
        capability=Capability.METRIC_DEPTH,
        purpose="Pull DA3METRIC-LARGE (Apache 2.0), SAM 3, MegaLoc, VGGT-1B-Commercial.",
        where_to_get="huggingface.co/settings/tokens",
        commercial_safe=True,
        free_tier="Free. VGGT-1B-Commercial needs a separate access application",
        required=True,
    ),
    Credential(
        env_var="VERTEX_AI_LOCATION",
        service="Vertex AI",
        capability=Capability.SEGMENTATION,
        purpose="Hosted GPU inference if not self-hosting the models.",
        where_to_get="Set a region, e.g. us-central1; auth via GOOGLE_APPLICATION_CREDENTIALS",
        commercial_safe=True,
        free_tier="Metered. Self-hosting on spot L4 is usually cheaper at volume",
        needs_signup=False,
    ),
    # --- Storage and data plane. ---
    Credential(
        env_var="SMC_DATABASE_URL",
        service="PostgreSQL + PostGIS",
        capability=Capability.DATABASE,
        purpose="The world-facts store. Cloud SQL or any Postgres with PostGIS.",
        where_to_get="postgresql://user:pass@host:5432/smc",
        commercial_safe=True,
        free_tier="n/a",
        required=True,
        needs_signup=False,
    ),
    Credential(
        env_var="SMC_OBJECT_STORE_URL",
        service="Object storage",
        capability=Capability.OBJECT_STORE,
        purpose="Transient imagery. Lifecycle-expired after fusion.",
        where_to_get="gs://bucket or s3://bucket",
        commercial_safe=True,
        free_tier="n/a",
        required=True,
        needs_signup=False,
    ),
    # --- Device side. ---
    Credential(
        env_var="META_WEARABLES_APP_ID",
        service="Meta Wearables Device Access Toolkit",
        capability=Capability.ANCHOR_IMAGERY,
        purpose="Glasses camera access. Mock Device Kit works without hardware.",
        where_to_get="developers.meta.com/wearables — Meta Managed Account, then create a project",
        commercial_safe=True,
        free_tier="Free SDK. Publishing is gated; GA targeted 2026",
    ),
)


@dataclass(frozen=True, slots=True)
class CredentialReport:
    configured: tuple[Credential, ...]
    missing: tuple[Credential, ...]

    @property
    def missing_required(self) -> tuple[Credential, ...]:
        return tuple(c for c in self.missing if c.required)

    @property
    def ok(self) -> bool:
        return not self.missing_required

    def render(self) -> str:
        lines: list[str] = []
        commercial_risk = [c for c in self.configured if not c.commercial_safe]

        signup = [c for c in self.missing if c.needs_signup]
        lines.append(f"configured: {len(self.configured)}   missing: {len(self.missing)}")
        lines.append(
            f"of the missing, {len(signup)} need an account somewhere; "
            "the rest are plain settings"
        )
        if self.missing_required:
            lines.append("")
            lines.append("REQUIRED, NOT SET — the system will not run:")
            for c in self.missing_required:
                lines.append(f"  {c.env_var:<32} {c.service}")
                lines.append(f"  {'':<32} -> {c.where_to_get}")
        optional_missing = [c for c in self.missing if not c.required]
        if optional_missing:
            lines.append("")
            lines.append("optional, not set:")
            for c in optional_missing:
                lines.append(f"  {c.env_var:<32} {c.service}  [{c.free_tier}]")
        if commercial_risk:
            lines.append("")
            lines.append("CONFIGURED BUT NOT COMMERCIAL-SAFE — internal build only:")
            for c in commercial_risk:
                lines.append(f"  {c.env_var:<32} {c.service}")
        return "\n".join(lines)


def check(credentials: tuple[Credential, ...] = CREDENTIALS) -> CredentialReport:
    return CredentialReport(
        configured=tuple(c for c in credentials if c.is_set),
        missing=tuple(c for c in credentials if not c.is_set),
    )


def providers_for(capability: Capability) -> tuple[Credential, ...]:
    return tuple(c for c in CREDENTIALS if c.capability is capability)
