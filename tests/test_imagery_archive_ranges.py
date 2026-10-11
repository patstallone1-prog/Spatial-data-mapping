import pytest

from smc.imagery.archive import RangedHttpFile


@pytest.mark.parametrize("status,header,body,valid", [
    (200, None, b"whole archive", False),
    (206, "bytes 0-3/100", b"abcd", True),
    (206, "bytes 1-4/100", b"abcd", False),
    (206, "bytes 0-3/100", b"abc", False),
    (206, "bytes 0-3/100", b"abcde", False),
])
def test_archive_never_reads_a_whole_response_or_accepts_misaligned_ranges(
    monkeypatch, status, header, body, valid,
):
    reads = []

    class Response:

        def __init__(self):
            self.headers = {"Content-Range": header}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size):
            reads.append(size)
            return body[:size]

    response = Response()
    response.status = status
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: response)
    file = RangedHttpFile.__new__(RangedHttpFile)
    file.url, file.size, file.pos, file.timeout, file.bytes_read = "https://fixture", 100, 0, 1, 0
    if valid:
        buffer = bytearray(4)
        assert file.readinto(buffer) == 4 and buffer == b"abcd"
        assert file.pos == file.bytes_read == 4
    else:
        with pytest.raises(OSError):
            file.readinto(bytearray(4))
        assert file.pos == file.bytes_read == 0
    assert not reads or reads == [5]
