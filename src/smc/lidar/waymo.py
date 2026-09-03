"""Waymo Open Dataset: access, and the terms that come with it.

Waymo drove San Francisco with five lidars and five cameras and published the result, including
per-point semantic labels that name road and sidewalk directly. For measuring kerbs that is
better data than anything else covering these blocks: it is ground-level, so a kerb face is
seen side-on rather than from an aircraft at the one angle that makes a 150 mm riser nearly
invisible.

It is also licensed for non-commercial use only, and the restriction is inherited. The terms
cover derivative intellectual property, which includes a model trained on the data, and they
require that anyone receiving such a model receives the licence with it. This project was
previously kept clear of that -- Mapillary was guarded for the same class of reason -- and the
decision to accept it here was made deliberately and is recorded in docs/17.

Two things this module will not do, because they are not ours to do:

* create or authenticate a Google account, and
* accept the licence agreement.

Both are acts of consent by a person. The dataset is readable only after a human has registered
at waymo.com/open and accepted the terms under their own account, and this module's job when
that has not happened is to say so precisely rather than to fail somewhere deep in a decoder.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

#: Version 2 is stored as Parquet, one file per component per segment, which means a bounded
#: region can be read without pulling whole TFRecord shards apart.
DEFAULT_BUCKET = "waymo_open_dataset_v_2_0_1"

#: The component carrying per-segment context, including which city the run was driven in.
STATS_COMPONENT = "stats"

#: What the dataset calls San Francisco in its location field.
SF_LOCATION = "location_sf"

LICENCE_URL = "https://waymo.com/open/terms/"
REGISTRATION_URL = "https://waymo.com/open/"


class WaymoAccessError(RuntimeError):
    """The dataset is not readable, with a description of what a person has to do."""


@dataclass(frozen=True, slots=True)
class AccessReport:
    reachable: bool
    account: str | None
    detail: str

    def require(self) -> None:
        if not self.reachable:
            raise WaymoAccessError(self.detail)


def _run(args: list[str], timeout_s: float = 60.0) -> tuple[int, str]:
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=timeout_s)
    except FileNotFoundError:
        return 127, "the gcloud CLI is not installed"
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def active_account() -> str | None:
    code, out = _run(
        ["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]
    )
    if code != 0:
        return None
    # gcloud writes warnings to the same stream as values, so a WARNING line would otherwise be
    # reported back to the user as the name of their account.
    for line in out.splitlines():
        candidate = line.strip()
        if candidate and "@" in candidate and not candidate.startswith("WARNING"):
            return candidate
    return None


def check_access(bucket: str = DEFAULT_BUCKET) -> AccessReport:
    """Whether this machine can currently read the dataset, and why not if it cannot."""
    account = active_account()
    code, out = _run(["gcloud", "storage", "ls", f"gs://{bucket}/"])
    if code == 0:
        return AccessReport(True, account, f"readable as {account}")

    lowered = out.lower()
    if "does not have any valid credentials" in lowered or "reauth" in lowered:
        detail = (
            f"Google credentials for {account or 'this machine'} have expired.\n"
            "  Run:  gcloud auth login\n"
            "        gcloud auth application-default login"
        )
    elif "403" in out or "forbidden" in lowered or "permission" in lowered:
        detail = (
            f"{account or 'This account'} is signed in but not admitted to the dataset.\n"
            f"  Register and accept the licence at {REGISTRATION_URL}\n"
            f"  using that same Google account. Terms: {LICENCE_URL}\n"
            "  Access is granted to the account that accepted them, and cannot be\n"
            "  accepted on your behalf."
        )
    elif code == 127:
        detail = "The gcloud CLI is not installed. Run: brew install --cask google-cloud-sdk"
    else:
        detail = f"gs://{bucket}/ could not be listed: {out.strip()[:300]}"
    return AccessReport(False, account, detail)


def sf_segment_paths(bucket: str = DEFAULT_BUCKET, split: str = "training") -> list[str]:
    """Every segment file in the stats component for a split.

    Which of them were driven in San Francisco is a question for the stats rows themselves;
    listing is separated from filtering so that the listing can be cached and the filter can be
    re-run without touching the network.
    """
    check_access(bucket).require()
    code, out = _run(
        ["gcloud", "storage", "ls", f"gs://{bucket}/{split}/{STATS_COMPONENT}/"], timeout_s=180
    )
    if code != 0:
        raise WaymoAccessError(f"could not list {STATS_COMPONENT}: {out.strip()[:300]}")
    return [line.strip() for line in out.splitlines() if line.strip().endswith(".parquet")]


# -- reading -----------------------------------------------------------------------------------
#
# Everything below runs against the v2 release, which is Parquet rather than the TFRecord of v1.
# That matters practically: the components can be read with pyarrow alone, so none of this pulls
# in TensorFlow or the waymo-open-dataset package.
#
# It also has a limit that decides what Waymo is good for here. Poses are expressed in a frame
# local to each segment, and the release publishes no absolute georeference -- the most specific
# location fact in the whole dataset is the string ``location_sf``. So these points cannot be
# placed on the corridor map, and Waymo cannot anchor a block the way Panoramax or KartaView can.
#
# What it can do is better than anchoring for the immediate question. It sees a kerb side-on from
# a metre and a half up, with per-point semantic labels that name the road and the sidewalk
# directly, which is the measurement the aerial pass can only sometimes make. Its role is to
# calibrate and check that pass -- to say what the distribution of real kerb heights is, and
# whether 118 mm from above is right -- rather than to add rows to the map.

#: Components this needs, in the order they are read.
LIDAR_COMPONENT = "lidar"
LIDAR_CALIBRATION_COMPONENT = "lidar_calibration"
LIDAR_POSE_COMPONENT = "lidar_pose"
SEGMENTATION_COMPONENT = "lidar_segmentation"

#: Waymo's 3D semantic classes, of the twenty-three, that this cares about. The kerb has a class
#: of its own, which is the single reason this dataset is worth the licence for this problem.
TYPE_CURB = 18
TYPE_ROAD = 17
TYPE_SIDEWALK = 20


def component_path(bucket: str, split: str, component: str, segment: str) -> str:
    return f"gs://{bucket}/{split}/{component}/{segment}"


def sf_segments(bucket: str = DEFAULT_BUCKET, split: str = "training") -> list[str]:
    """Segment names recorded as driven in San Francisco.

    The ``stats`` component carries one row per frame with a ``location`` string. Reading it is
    cheap next to the lidar, so the whole split is filtered before anything heavy is fetched.
    """
    import pyarrow.dataset as ds

    check_access(bucket).require()
    stats = component_path(bucket, split, STATS_COMPONENT, "")
    try:
        table = ds.dataset(stats.removeprefix("gs://"), filesystem=_filesystem(), format="parquet")
        scanned = table.to_table(columns=["key.segment_context_name", "[StatsComponent].location"])
    except Exception as exc:  # noqa: BLE001 - surfaced with the remediation, not swallowed
        raise WaymoAccessError(f"could not read the stats component: {exc}") from exc

    names = scanned.column("key.segment_context_name").to_pylist()
    places = scanned.column("[StatsComponent].location").to_pylist()
    return sorted({n for n, p in zip(names, places) if p == SF_LOCATION and n})


def _filesystem():
    """A GCS filesystem using the account that accepted the licence."""
    try:
        from pyarrow.fs import GcsFileSystem
    except ImportError as exc:  # pragma: no cover - pyarrow always ships this
        raise WaymoAccessError(f"pyarrow has no GCS support: {exc}") from exc
    return GcsFileSystem()
