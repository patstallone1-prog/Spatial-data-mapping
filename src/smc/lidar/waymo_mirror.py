"""Read Waymo Open Dataset v1.4.3 from the public Hugging Face mirror.

Waymo's own bucket refuses anonymous callers -- verified directly over HTTPS across four version
names, not inferred from a local credential error. The operator of this project directed that the
data be taken from a third-party mirror instead. That decision, and precisely what it does and
does not change about the licence, is recorded in ``data/waymo_sf/PROVENANCE.md``. Read it before
building anything further on this module: the non-commercial restriction is inherited by any
model trained on this data whichever route the bytes took.

Two things make this affordable without TensorFlow or the waymo-open-dataset package.

The first is that a TFRecord is trivially framed -- an 8-byte little-endian length, a CRC, the
payload, another CRC -- so records can be sliced out of an HTTP range request without a reader
library. The second is that ``Frame.context`` is field 1 of the message, so it lands at the front
of the serialised bytes: the location of a twenty-second segment can be read from a 64 KB prefix
rather than by fetching the whole ~5 MB first record, let alone the ~1 GB file. Scanning the
entire release for the San Francisco segments costs about 130 MB.

The protobuf definitions are Apache-2.0 and are compiled on demand by
``scripts/build_waymo_protos.py`` into ``build/waymo_proto``, which is gitignored: generated code
is a build artefact and vendoring it invites the compiled and the source copies to drift.
"""

from __future__ import annotations

import struct
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

HF_REPO = "AnnaZhang/waymo_open_dataset_v_1_4_3"
HF_FILES = f"https://huggingface.co/api/datasets/{HF_REPO}"
HF_RESOLVE = f"https://huggingface.co/datasets/{HF_REPO}/resolve/main"

#: Where the generated protobuf modules land. Gitignored on purpose.
PROTO_BUILD = Path("build/waymo_proto")

#: v1 spells the locations this way. v2 uses the same strings, which is why the constant is
#: shared -- but v1 is what the mirror carries.
LOCATION_SF = "location_sf"

#: Enough of a frame to hold ``context``. Measured, not guessed: at 64 KB the context of every
#: segment tried so far parses complete, including all five laser calibrations.
CONTEXT_PREFIX_BYTES = 65536

#: TFRecord framing: length (8 bytes) + masked CRC of the length (4 bytes) precede the payload.
TFRECORD_HEADER_BYTES = 12


class WaymoMirrorError(RuntimeError):
    """The mirror could not be read, or the protos are not compiled."""


def load_protos():
    """Import the generated protobuf modules, or say exactly how to make them."""
    if str(PROTO_BUILD) not in sys.path:
        sys.path.insert(0, str(PROTO_BUILD))
    try:
        from waymo_open_dataset import dataset_pb2  # noqa: PLC0415
    except ImportError as exc:
        raise WaymoMirrorError(
            "Waymo protobuf modules are not compiled. Run: "
            ".venv/bin/python scripts/build_waymo_protos.py"
        ) from exc
    return dataset_pb2


@dataclass(frozen=True, slots=True)
class Segment:
    """One twenty-second run, and where it was driven."""

    path: str
    split: str
    location: str
    name: str

    @property
    def url(self) -> str:
        return f"{HF_RESOLVE}/{self.path}"


def _get(url: str, *, start: int | None = None, end: int | None = None, timeout: float = 120.0) -> bytes:
    headers = {}
    if start is not None:
        headers["Range"] = f"bytes={start}-{end if end is not None else ''}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def segment_paths() -> list[str]:
    """Every ``.tfrecord`` in the mirror, from the repository listing."""
    import json  # noqa: PLC0415

    payload = json.loads(_get(HF_FILES).decode("utf-8"))
    return sorted(
        s["rfilename"]
        for s in (payload.get("siblings") or [])
        if s.get("rfilename", "").endswith(".tfrecord")
    )


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, i


def first_length_delimited(buf: bytes, want: int) -> bytes | None:
    """Bytes of the first length-delimited field numbered ``want``.

    Walks the wire format by hand rather than parsing the message, because the buffer is a
    deliberate prefix: a real parse would fail on the truncation, and the whole point is to avoid
    fetching the rest.
    """
    i = 0
    while i < len(buf):
        try:
            key, i = _varint(buf, i)
        except IndexError:
            return None
        field, wire = key >> 3, key & 7
        if wire == 2:
            try:
                length, i = _varint(buf, i)
            except IndexError:
                return None
            if field == want:
                return buf[i : i + length] if i + length <= len(buf) else None
            i += length
        elif wire == 0:
            try:
                _, i = _varint(buf, i)
            except IndexError:
                return None
        elif wire == 1:
            i += 8
        elif wire == 5:
            i += 4
        else:
            return None
    return None


def segment_context(path: str, *, prefix_bytes: int = CONTEXT_PREFIX_BYTES):
    """The ``Context`` of a segment's first frame, from a small prefix of the file."""
    dataset_pb2 = load_protos()
    url = f"{HF_RESOLVE}/{path}"
    start = TFRECORD_HEADER_BYTES
    payload = _get(url, start=start, end=start + prefix_bytes - 1)
    raw = first_length_delimited(payload, 1)
    if raw is None:
        raise WaymoMirrorError(f"{path}: context did not fit in {prefix_bytes} bytes")
    context = dataset_pb2.Context()
    context.ParseFromString(raw)
    return context


def scan_locations(
    paths: list[str], *, workers: int = 12, progress=None
) -> list[Segment]:
    """Read the location of every segment, several at a time.

    Each read is a small range request that spends nearly all its time waiting, so concurrency
    is most of the difference between minutes and an hour.
    """

    def one(path: str) -> Segment | None:
        try:
            context = segment_context(path)
        except (WaymoMirrorError, urllib.error.URLError, OSError, IndexError):
            return None
        split = path.split("/")[1] if "/" in path else "unknown"
        return Segment(path, split, context.stats.location or "unknown", context.name)

    found: list[Segment] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for index, segment in enumerate(pool.map(one, paths), start=1):
            if segment is not None:
                found.append(segment)
            if progress and (index % 50 == 0 or index == len(paths)):
                sf = sum(s.location == LOCATION_SF for s in found)
                progress(f"scanned {index}/{len(paths)} segments, {sf} in San Francisco")
    return found


#: A segment is around a gigabyte and holds roughly two hundred frames, so a handful of frames
#: is a few percent of the file. Fetching a prefix rather than the whole thing is the difference
#: between sampling a segment in seconds and in minutes.
SAMPLE_BYTES = 48 * 1024 * 1024


def iter_records(url: str, *, limit: int | None = None, max_bytes: int | None = None):
    """Whole frames from a segment.

    ``max_bytes`` fetches only a prefix of the file. Records are laid out end to end, so a prefix
    yields whole frames from the start of the run and stops cleanly at the first one that is cut
    off -- which is what sampling a segment wants, and it avoids pulling a gigabyte to look at
    five frames. Leave it unset to walk the whole segment.
    """
    dataset_pb2 = load_protos()
    if max_bytes is not None:
        blob = _get(url, start=0, end=max_bytes - 1, timeout=600.0)
    else:
        blob = _get(url, timeout=600.0)
    offset = 0
    count = 0
    while offset + TFRECORD_HEADER_BYTES <= len(blob):
        (length,) = struct.unpack("<Q", blob[offset : offset + 8])
        start = offset + TFRECORD_HEADER_BYTES
        end = start + length
        if end > len(blob):
            break
        frame = dataset_pb2.Frame()
        frame.ParseFromString(blob[start:end])
        yield frame
        count += 1
        if limit is not None and count >= limit:
            return
        offset = end + 4  # trailing CRC of the payload
