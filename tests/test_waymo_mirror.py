"""The hand-written protobuf prefix walker.

Everything else in this module is a thin wrapper over urllib or the generated protobuf classes.
This one function parses the wire format by hand, on a deliberately truncated buffer, and a
mistake in it would not raise -- it would silently return the wrong field or None, and a whole
release would be scanned as "no San Francisco segments here".
"""

from __future__ import annotations

import unittest

from smc.lidar.waymo_mirror import first_length_delimited


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def delimited(field: int, payload: bytes) -> bytes:
    return varint(field << 3 | 2) + varint(len(payload)) + payload


def varint_field(field: int, value: int) -> bytes:
    return varint(field << 3 | 0) + varint(value)


class TestPrefixWalker(unittest.TestCase):
    def test_finds_the_field_it_is_asked_for(self) -> None:
        buf = delimited(1, b"context-bytes") + delimited(3, b"pose")
        self.assertEqual(first_length_delimited(buf, 1), b"context-bytes")
        self.assertEqual(first_length_delimited(buf, 3), b"pose")

    def test_skips_fields_of_every_wire_type_on_the_way(self) -> None:
        # A varint, a fixed64 and a fixed32 all precede the wanted field. Mis-measuring any of
        # them desynchronises the walk and everything after it is read as garbage.
        buf = (
            varint_field(2, 1_234_567)
            + varint(4 << 3 | 1) + b"\x00" * 8
            + varint(5 << 3 | 5) + b"\x00" * 4
            + delimited(1, b"payload")
        )
        self.assertEqual(first_length_delimited(buf, 1), b"payload")

    def test_returns_none_when_the_field_is_cut_off_by_the_prefix(self) -> None:
        # The whole reason this exists: the buffer is a prefix, so a field can be announced and
        # then not be there. Returning a short read would hand a truncated message to the parser.
        buf = delimited(1, b"a-long-context-value")[:12]
        self.assertIsNone(first_length_delimited(buf, 1))

    def test_returns_none_rather_than_raising_on_a_truncated_header(self) -> None:
        self.assertIsNone(first_length_delimited(b"\x8a", 1))
        self.assertIsNone(first_length_delimited(b"", 1))

    def test_returns_none_when_the_field_is_absent(self) -> None:
        self.assertIsNone(first_length_delimited(delimited(7, b"x"), 1))

    def test_takes_the_first_of_a_repeated_field(self) -> None:
        buf = delimited(1, b"first") + delimited(1, b"second")
        self.assertEqual(first_length_delimited(buf, 1), b"first")


if __name__ == "__main__":
    unittest.main()
