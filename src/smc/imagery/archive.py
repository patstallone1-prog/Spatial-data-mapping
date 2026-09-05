"""Read inside a remote ZIP without downloading it.

Some datasets are published as one enormous archive. PandaSet is 44.5 GB in a single zip, and
this machine has rather less free disk than that -- but a zip keeps its index at the end and its
members at known offsets, so with HTTP range requests the whole archive is randomly accessible
where it sits.

The numbers are the argument: reading the directory of all 75,758 members costs 9 MB, and
deciding which of the 103 sequences fall inside a bounding box costs 117 MB. Downloading the
archive to answer the same question would cost 44.5 GB and would not fit.
"""

from __future__ import annotations

import io
import urllib.request


class RangedHttpFile(io.RawIOBase):
    """A seekable read-only file over HTTP range requests.

    Wrap in :class:`io.BufferedReader` before handing to ``zipfile``: unbuffered, the many small
    reads a zip directory scan performs become one request each.
    """

    def __init__(self, url: str, *, timeout: float = 180.0) -> None:
        self.url = url
        self.timeout = timeout
        self.pos = 0
        #: Bytes actually pulled, so a caller can report the cost of a scan honestly.
        self.bytes_read = 0
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=60) as response:
            length = response.headers.get("Content-Length") or response.headers.get("X-Linked-Size")
            if not length:
                raise OSError(f"{url}: no length, so the archive cannot be seeked")
            # Hugging Face answers HEAD for an LFS object with the pointer's length in
            # Content-Length and the real one in X-Linked-Size. Trusting the former truncates
            # the archive to about a kilobyte and the zip directory is then simply absent.
            self.size = int(response.headers.get("X-Linked-Size") or length)
            if response.headers.get("Accept-Ranges") != "bytes":
                raise OSError(f"{url}: server does not accept range requests")

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def tell(self) -> int:
        return self.pos

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    def readinto(self, buffer) -> int:  # type: ignore[override]
        wanted = len(buffer)
        if wanted == 0 or self.pos >= self.size:
            return 0
        end = min(self.pos + wanted, self.size) - 1
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            data = response.read()
        buffer[: len(data)] = data
        self.pos += len(data)
        self.bytes_read += len(data)
        return len(data)
