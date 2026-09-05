"""Read a ROS bag over HTTP range requests.

UrbanLoco's San Francisco data is seven bags totalling 387 GB, and this machine has eighteen
gigabytes free. Downloading is not an option, but it does not need to be: a bag, like a zip,
carries an index. The header at byte thirteen holds ``index_pos``, everything after that offset
describes the connections and the chunks, and every chunk states where it begins. So the bag is
randomly accessible where it sits, and only the chunks that carry the wanted topics are ever
fetched.

The format is a sequence of records, each

    <uint32 header length><header><uint32 data length><data>

where a header is repeated ``<uint32 field length><name=value>`` pairs. ``op`` names the record
type: 0x03 the bag header, 0x05 a chunk, 0x07 a connection, 0x06 a chunk's index entry.
"""

from __future__ import annotations

import bz2
import io
import struct
import urllib.request
from dataclasses import dataclass, field

MAGIC = b"#ROSBAG V2.0\n"

OP_BAG_HEADER = 0x03
OP_CHUNK = 0x05
OP_CHUNK_INFO = 0x06
OP_CONNECTION = 0x07


class RosbagError(RuntimeError):
    pass


def parse_header(blob: bytes) -> dict[str, bytes]:
    """The ``name=value`` fields of one record header."""
    fields: dict[str, bytes] = {}
    offset = 0
    while offset + 4 <= len(blob):
        (length,) = struct.unpack_from("<I", blob, offset)
        offset += 4
        chunk = blob[offset : offset + length]
        offset += length
        split = chunk.find(b"=")
        if split < 0:
            continue
        fields[chunk[:split].decode("utf-8", "replace")] = chunk[split + 1 :]
    return fields


@dataclass(frozen=True, slots=True)
class Connection:
    """One topic in the bag."""

    conn_id: int
    topic: str
    message_type: str


@dataclass(frozen=True, slots=True)
class ChunkInfo:
    """Where a chunk sits and what it contains."""

    position: int
    start_time_ns: int
    end_time_ns: int
    counts: dict[int, int] = field(default_factory=dict)

    def carries(self, conn_ids: set[int]) -> bool:
        return any(self.counts.get(c, 0) for c in conn_ids)


class RangedReader:
    """Byte ranges from a URL, following redirects once."""

    def __init__(self, url: str, *, timeout: float = 300.0) -> None:
        self.url = url
        self.timeout = timeout
        self.bytes_read = 0
        # The redirect target is deliberately not kept. Dropbox hands out a signed, short-lived
        # CDN link per request, so reusing the one a HEAD resolved to earns a 403 on the first
        # range read. Every request re-follows from the share URL instead.
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            length = response.headers.get("Content-Length")
            if not length:
                raise RosbagError(f"{url}: no length; cannot seek")
            self.size = int(length)
            if response.headers.get("Accept-Ranges") != "bytes":
                raise RosbagError(f"{url}: no range support")

    def read(self, start: int, length: int) -> bytes:
        if length <= 0 or start >= self.size:
            return b""
        end = min(start + length, self.size) - 1
        request = urllib.request.Request(
            self.url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            data = response.read()
        self.bytes_read += len(data)
        return data


class RemoteBag:
    """A ROS bag read in place."""

    def __init__(self, url: str) -> None:
        self.reader = RangedReader(url)
        self.connections: dict[int, Connection] = {}
        self.chunks: list[ChunkInfo] = []
        self._index_pos = 0
        self._read_index()

    @property
    def bytes_read(self) -> int:
        return self.reader.bytes_read

    def _record_at(self, offset: int, blob: bytes, base: int) -> tuple[dict, bytes, int]:
        """One record starting at ``offset`` within ``blob`` which begins at file ``base``."""
        (header_len,) = struct.unpack_from("<I", blob, offset)
        header = parse_header(blob[offset + 4 : offset + 4 + header_len])
        after = offset + 4 + header_len
        (data_len,) = struct.unpack_from("<I", blob, after)
        data = blob[after + 4 : after + 4 + data_len]
        return header, data, after + 4 + data_len

    def _read_index(self) -> None:
        head = self.reader.read(0, 4096)
        if not head.startswith(MAGIC):
            raise RosbagError("not a ROS bag v2.0")
        header, _, _ = self._record_at(len(MAGIC), head, 0)
        if header.get("op", b"\x00")[0] != OP_BAG_HEADER:
            raise RosbagError("first record is not the bag header")
        self._index_pos = struct.unpack("<Q", header["index_pos"])[0]
        if self._index_pos == 0 or self._index_pos >= self.reader.size:
            raise RosbagError("bag has no usable index; it was probably not closed cleanly")

        tail = self.reader.read(self._index_pos, self.reader.size - self._index_pos)
        offset = 0
        while offset + 8 < len(tail):
            try:
                header, data, offset = self._record_at(offset, tail, self._index_pos)
            except (struct.error, IndexError):
                break
            op = header.get("op", b"\x00")[0]
            if op == OP_CONNECTION:
                conn_id = struct.unpack("<I", header["conn"])[0]
                topic = header["topic"].decode("utf-8", "replace")
                detail = parse_header(data)
                self.connections[conn_id] = Connection(
                    conn_id, topic, detail.get("type", b"").decode("utf-8", "replace")
                )
            elif op == OP_CHUNK_INFO:
                counts: dict[int, int] = {}
                for i in range(struct.unpack("<I", header["count"])[0]):
                    conn_id, n = struct.unpack_from("<II", data, i * 8)
                    counts[conn_id] = n
                self.chunks.append(
                    ChunkInfo(
                        struct.unpack("<Q", header["chunk_pos"])[0],
                        struct.unpack("<Q", header["start_time"])[0],
                        struct.unpack("<Q", header["end_time"])[0],
                        counts,
                    )
                )
        self.chunks.sort(key=lambda c: c.position)

    def topics(self) -> dict[str, int]:
        """Topic name to total message count across the bag."""
        totals: dict[str, int] = {}
        for chunk in self.chunks:
            for conn_id, n in chunk.counts.items():
                connection = self.connections.get(conn_id)
                if connection:
                    totals[connection.topic] = totals.get(connection.topic, 0) + n
        return totals

    def read_chunk(self, chunk: ChunkInfo) -> bytes:
        """A chunk's messages, decompressed.

        The chunk record does not state its own length, so enough is fetched to reach the next
        chunk -- or a generous ceiling for the last one.
        """
        following = [c.position for c in self.chunks if c.position > chunk.position]
        span = (min(following) if following else self._index_pos) - chunk.position
        blob = self.reader.read(chunk.position, span)
        header, data, _ = self._record_at(0, blob, chunk.position)
        compression = header.get("compression", b"none").decode("utf-8", "replace")
        if compression == "bz2":
            return bz2.decompress(data)
        if compression == "lz4":
            import lz4.frame  # noqa: PLC0415 - optional, and only some bags use it

            return lz4.frame.decompress(data)
        return data

    def messages(self, chunk: ChunkInfo, conn_ids: set[int]):
        """Yield ``(conn_id, timestamp_ns, payload)`` for the wanted topics in one chunk."""
        blob = self.read_chunk(chunk)
        offset = 0
        while offset + 8 < len(blob):
            try:
                header, data, offset = self._record_at(offset, blob, 0)
            except (struct.error, IndexError):
                break
            if header.get("op", b"\x00")[0] != 0x02:  # message data
                continue
            conn_id = struct.unpack("<I", header["conn"])[0]
            if conn_id not in conn_ids:
                continue
            yield conn_id, struct.unpack("<Q", header["time"])[0], data
