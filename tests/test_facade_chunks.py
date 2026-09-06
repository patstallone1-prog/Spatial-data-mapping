from __future__ import annotations

import pytest

from smc.facades.chunks import ChunkIndex, chunk_grid

BBOX = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}


class TestGrid:
    def test_chunks_are_square_on_the_ground_not_in_degrees(self):
        chunk = next(iter(chunk_grid(BBOX).values()))
        # A degree of longitude here is about 79 per cent of a degree of latitude, so a square
        # chunk must be wider in degrees than it is tall.
        ratio = (chunk.east - chunk.west) / (chunk.north - chunk.south)
        assert ratio == pytest.approx(1.0 / 0.79, rel=0.02)

    def test_the_grid_covers_the_whole_box(self):
        chunks = chunk_grid(BBOX)
        assert min(c.west for c in chunks.values()) <= BBOX["west"] + 1e-9
        assert max(c.east for c in chunks.values()) >= BBOX["east"]
        assert max(c.north for c in chunks.values()) >= BBOX["north"]

    def test_chunks_do_not_overlap(self):
        chunks = list(chunk_grid(BBOX).values())
        lon = (BBOX["west"] + BBOX["east"]) / 2.0
        lat = (BBOX["south"] + BBOX["north"]) / 2.0
        assert sum(1 for c in chunks if c.contains(lon, lat)) == 1

    def test_smaller_chunks_means_more_of_them(self):
        assert len(chunk_grid(BBOX, size_m=125.0)) > len(chunk_grid(BBOX, size_m=250.0))


class TestIndex:
    def test_the_index_agrees_with_a_scan(self):
        chunks = chunk_grid(BBOX)
        index = ChunkIndex(chunks)
        for lon, lat in [(-122.40, 37.79), (-122.4474, 37.7861), (-122.4, 37.805)]:
            scanned = next((c for c in chunks.values() if c.contains(lon, lat)), None)
            assert index.find(lon, lat) is scanned

    def test_a_point_outside_the_region_has_no_chunk(self):
        index = ChunkIndex(chunk_grid(BBOX))
        assert index.find(-122.6, 37.79) is None
        assert index.find(-122.40, 37.95) is None
