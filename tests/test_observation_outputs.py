"""The observation outputs of the interior pass: facade survey, street objects, scans, plans."""

from __future__ import annotations

import io
import json
import pickle
import struct

import cv2
import numpy as np
import pytest

from smc.facades import survey
from smc.interiors import resplan
from smc.interiors.geometry import area, polygons_from_wkb, polygons_from_wkt
from smc.lidar import objects
from smc.scans import classify, readers, sketchfab
from smc.scans.sources import licence

PPM = 10.0  # pixels per metre in the synthetic facades


def facade(storeys: int, storey_m: float = 3.2, sky_m: float = 3.0, width_m: float = 16.0):
    """A pale wall with a dark window grid, one row a storey, and blue sky above its roof."""
    wall_h = storeys * storey_m
    h, w = int((wall_h + sky_m) * PPM), int(width_m * PPM)
    img = np.full((h, w, 3), (150, 170, 190), np.uint8)       # BGR: warm pale render
    img[: int(sky_m * PPM)] = (235, 200, 170)                   # BGR: pale blue sky
    for s in range(storeys):
        sill = s * storey_m + 0.9
        y1 = h - int(sill * PPM)
        y0 = y1 - int(1.5 * PPM)
        for k in range(4):
            x0 = int((1.5 + k * 3.6) * PPM)
            img[y0:y1, x0:x0 + int(1.2 * PPM)] = (40, 40, 45)
    return img, np.ones((h, w), bool), wall_h


class TestFacadeSurvey:
    def test_windows_rows_and_storeys_are_measured(self):
        img, seen, wall_h = facade(5)
        result = survey.survey_wall(img, seen, PPM, modelled_height_m=12.0)
        assert result.roof_seen
        assert result.roofline_m == pytest.approx(wall_h, abs=0.3)
        windows = [o for o in result.openings if o.kind == "window"]
        assert len(windows) == 20
        assert all(o.w == pytest.approx(1.2, abs=0.2) and o.h == pytest.approx(1.5, abs=0.2)
                   for o in windows)
        assert len(result.rows) == 5
        assert result.storey_m == pytest.approx(3.2, abs=0.15)
        assert result.storeys == 5

    def test_storeys_have_no_ceiling(self):
        img, seen, wall_h = facade(60, width_m=14.0)
        result = survey.survey_wall(img, seen, PPM, modelled_height_m=40.0)
        assert result.roofline_m == pytest.approx(wall_h, abs=0.3)
        assert result.storeys == 60

    def test_a_roof_out_of_view_is_a_lower_bound_not_a_measurement(self):
        img, seen, _ = facade(4, sky_m=0.0)
        result = survey.survey_wall(img, seen, PPM, modelled_height_m=12.0)
        assert not result.roof_seen and result.roofline_m is None
        assert any("lower bound" in note for note in result.notes)

    def test_building_storeys_from_measured_height_are_uncapped(self):
        walls = [{"roof_seen": False, "visible_h": 30.0, "storey_m": 3.5, "ground": "blank"}]
        out = survey.combine_building(walls, measured_height_m=320.0,
                                      height_source="lidar_region")
        assert out["storeys"] == round(320.0 / 3.5)
        assert out["photo_height_m"] is None and out["height_lower_bound_m"] == 30.0
        assert "lidar_region" in out["storeys_from"]


def _street_scene():
    rng = np.random.default_rng(3)
    ground = np.column_stack([rng.uniform(0, 40, 6000), rng.uniform(0, 40, 6000),
                              np.zeros(6000)])
    pole = np.column_stack([np.full(40, 10.0) + rng.normal(0, 0.03, 40),
                            np.full(40, 10.0) + rng.normal(0, 0.03, 40),
                            np.linspace(0.5, 8.0, 40)])
    post = np.column_stack([30 + rng.normal(0, 0.05, 20), 10 + rng.normal(0, 0.05, 20),
                            rng.uniform(0.4, 0.8, 20)])
    bench = np.column_stack([rng.uniform(19, 21, 40), 30 + rng.uniform(-0.25, 0.25, 40),
                             rng.uniform(0.42, 0.5, 40)])
    angle = rng.uniform(0, 2 * np.pi, 200)
    radius = rng.uniform(0, 2.5, 200)
    canopy = np.column_stack([8 + radius * np.cos(angle), 30 + radius * np.sin(angle),
                              rng.uniform(5.0, 7.0, 200)])
    trunk = np.column_stack([np.full(8, 8.0), np.full(8, 30.0), np.linspace(0.5, 1.2, 8)])
    xyz = np.vstack([ground, pole, post, bench, canopy, trunk])
    classes = np.concatenate([np.full(len(ground), 2), np.full(len(xyz) - len(ground), 1)])
    return xyz, classes


class TestStreetObjects:
    def test_each_shape_is_found_where_it_stands(self):
        xyz, classes = _street_scene()
        found = objects.detect(xyz, classes)
        kinds = {o.kind: o for o in found}
        assert {"pole", "short_post", "bench_candidate", "tree"} <= set(kinds)
        assert (kinds["pole"].east, kinds["pole"].north) == pytest.approx((10, 10), abs=0.2)
        assert kinds["pole"].height_m == pytest.approx(8.0, abs=0.5)
        assert kinds["bench_candidate"].length_m == pytest.approx(2.0, abs=0.3)

    def test_points_inside_a_footprint_are_not_street_objects(self):
        xyz, classes = _street_scene()
        square = np.array([[9, 9], [11, 9], [11, 11], [9, 11]], float)
        inside = objects.points_in_polygons(xyz[:, :2], [square])
        assert inside.sum() >= 40
        assert "pole" not in {o.kind for o in objects.detect(xyz, classes, inside)}


def _glb(vertices: np.ndarray, faces: np.ndarray, translation=(0.0, 0.0, 0.0)) -> bytes:
    pos = vertices.astype(np.float32).tobytes()
    idx = faces.astype(np.uint32).tobytes()
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"mesh": 0, "translation": list(translation)}],
           "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
           "buffers": [{"byteLength": len(pos) + len(idx)}],
           "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
                           {"buffer": 0, "byteOffset": len(pos), "byteLength": len(idx)}],
           "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(vertices),
                          "type": "VEC3"},
                         {"bufferView": 1, "componentType": 5125, "count": faces.size,
                          "type": "SCALAR"}]}
    text = json.dumps(doc).encode()
    text += b" " * (-len(text) % 4)
    binary = pos + idx
    binary += b"\0" * (-len(binary) % 4)
    body = struct.pack("<I4s", len(text), b"JSON") + text + \
        struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


def _box(size: tuple[float, float, float], closed: bool = True):
    """A box's surface sampled as points, z up; `closed` False leaves the lid off."""
    rng = np.random.default_rng(0)
    dims = np.asarray(size, float)
    faces = range(6 if closed else 5)  # faces 0..2 at 0, 3..5 at the far side; 5 is the lid
    areas = np.array([np.prod(np.delete(dims, f % 3)) for f in faces])
    face = rng.choice(list(faces), 8000, p=areas / areas.sum())  # as dense as a scan: by area
    pts = rng.uniform(0, 1, (len(face), 3)) * dims
    axis, side = face % 3, face // 3
    pts[np.arange(len(pts)), axis] = np.where(side == 0, 0.0, dims[axis])
    return pts


class TestScans:
    def test_glb_round_trip_applies_the_node_transform(self, tmp_path):
        verts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], float)
        path = tmp_path / "tri.glb"
        path.write_bytes(_glb(verts, np.array([[0, 1, 2]]), translation=(5, 0, 0)))
        points, mesh = readers.read(path)
        assert mesh.triangle_count == 1
        assert points[:, 0].min() == pytest.approx(5.0)

    def test_compressed_gltf_is_refused_by_name(self, tmp_path):
        path = tmp_path / "c.gltf"
        path.write_text(json.dumps({"extensionsUsed": ["KHR_draco_mesh_compression"]}))
        with pytest.raises(readers.UnreadableScan, match="draco"):
            readers.read(path)

    def test_obj_and_binary_ply(self, tmp_path):
        (tmp_path / "q.obj").write_text("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n")
        _, mesh = readers.read(tmp_path / "q.obj")
        assert mesh.triangle_count == 2
        verts = np.array([[0, 0, 0], [2, 0, 0], [0, 2, 0]], "<f4")
        header = (b"ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\n"
                  b"property float y\nproperty float z\nelement face 1\n"
                  b"property list uchar int vertex_indices\nend_header\n")
        body = verts.tobytes() + struct.pack("<B3i", 3, 0, 1, 2)
        (tmp_path / "t.ply").write_bytes(header + body)
        points, mesh = readers.read(tmp_path / "t.ply")
        assert mesh.triangle_count == 1 and points[1, 0] == pytest.approx(2.0)

    def test_a_room_an_object_and_a_facade_are_told_apart(self):
        assert classify.classify(_box((4, 5, 2.6))).kind == "single_room"
        assert classify.classify(_box((0.6, 0.6, 0.9))).kind == "movable_object"
        assert classify.classify(_box((30, 25, 6), closed=True)).kind == "interior_space"
        exterior = classify.classify(_box((20, 12, 9), closed=False))
        assert exterior.kind == "exterior" and exterior.keep and exterior.up_axis == "z"
        y_up = classify.classify(_box((20, 12, 9), closed=False)[:, [0, 2, 1]], up=1)
        assert y_up.kind == "exterior" and y_up.up_axis == "y"

    def test_licences(self):
        assert licence("CC Attribution")[1:3] == (True, True)
        assert licence("CC Attribution-NonCommercial")[1:3] == (True, False)
        assert licence("CC Attribution-NoDerivs")[1] is False
        assert licence("Standard")[1] is False

    def test_catalogue_candidate_records_attribution_and_refusals(self):
        result = {"uid": "abc", "name": "Mural, San Francisco", "viewerUrl": "https://x/abc",
                  "license": {"label": "CC Attribution"}, "user": {"displayName": "A. Scanner"},
                  "categories": [{"name": "animals-pets"}], "tags": [], "faceCount": 10}
        item = sketchfab.candidate(result)
        assert not item.usable and "not a place" in item.refused
        assert "A. Scanner" in item.attribution() and "Sketchfab" in item.attribution()
        result["categories"] = []
        item = sketchfab.candidate(result)
        assert item.usable and sketchfab.names_place(item, "San Francisco")
        assert not sketchfab.names_place(sketchfab.candidate(
            dict(result, name="42 Berkeley Pl")), "Berkeley Hills")


def _wkb_polygon(ring: list[tuple[float, float]]) -> bytes:
    closed = [*ring, ring[0]]
    return struct.pack("<BII", 1, 3, 1) + struct.pack("<I", len(closed)) + \
        np.asarray(closed, "<f8").tobytes()


class TestFloorPlans:
    def test_wkt_and_wkb_polygons(self):
        (outer, hole), = polygons_from_wkt(
            "POLYGON ((0 0, 4 0, 4 3, 0 3, 0 0), (1 1, 2 1, 2 2, 1 2, 1 1))")
        assert abs(area(outer)) == pytest.approx(12.0) and abs(area(hole)) == pytest.approx(1)
        (ring,), = polygons_from_wkb(_wkb_polygon([(0, 0), (2, 0), (2, 2)]))
        assert abs(area(ring)) == pytest.approx(2.0)

    def test_resplan_unpickler_refuses_anything_but_geometry(self):
        class Evil:
            def __reduce__(self):
                import os
                return (os.system, ("true",))

        with pytest.raises(pickle.UnpicklingError, match="refused"):
            resplan._Restricted(io.BytesIO(pickle.dumps(Evil()))).load()

    def test_resplan_scale_must_make_walls_plausible(self):
        inner = _wkb_polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
        wall = _wkb_polygon([(0, 0), (104, 0), (104, 4), (0, 4)])
        # 10,416 canvas units² drawn for a 94 m² flat: 0.095 m a unit, walls 4 units = 0.38 m
        plan = {"inner": inner, "wall": wall, "area": 94.0, "wall_depth": 4.0}
        scale, _ = resplan.metric_scale(plan)
        assert scale == pytest.approx((94.0 / (10000 + 416)) ** 0.5)
        plan["wall_depth"] = 40.0
        assert resplan.metric_scale(plan)[0] is None


def test_a_trickling_response_is_abandoned_at_its_deadline():
    import time

    from smc.net import read_by

    class Trickle:
        def read1(self, n):
            time.sleep(0.2)
            return b"x"

    with pytest.raises(TimeoutError):
        read_by(Trickle(), 0.5)


def test_a_request_that_never_answers_is_abandoned_at_its_deadline(monkeypatch):
    import threading
    import urllib.request

    from smc import net

    hang = threading.Event()
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: hang.wait(30))
    with pytest.raises(TimeoutError):
        net.fetch("https://example.invalid/", 0.3)
    hang.set()


def _relief_scene(monkeypatch):
    """A 30 m wall with a bay standing 0.5 m out, seen by two cameras either side of square.

    Rectification is replaced by its geometry: a camera whose ray meets the wall at tan(t) from
    square sees, on a plane d out, the texture of the true surface displaced by (d_true - d) t.
    """
    from smc.facades import relief
    from smc.facades.geometry import Camera, Wall
    from smc.facades.rectify import View

    rng = np.random.default_rng(7)
    tex_ppm = 20.0
    texture = cv2.resize(rng.uniform(0, 255, (50, 180)).astype(np.float32), (720, 200),
                         interpolation=cv2.INTER_CUBIC)  # 36 m x 10 m of smooth texture

    def d_true(u, z):
        return np.where((u > 12) & (u < 18) & (z > 2) & (z < 6), 0.5, 0.0)

    def fake(image, camera, wall, *, pixels_per_m, exact=False, weight=1.0):
        w = max(1, round(wall.length_m * pixels_per_m))
        h = max(1, round(wall.height_m * pixels_per_m))
        d = -wall.a[1]
        u = wall.a[0] + (np.arange(w) + 0.5) / pixels_per_m
        z = wall.height_m - (np.arange(h) + 0.5) / pixels_per_m
        uu, zz = np.meshgrid(u, z)
        t = (15.0 - camera.x) / 10.0
        su = uu + (d_true(uu, zz) - d) * t
        grey = cv2.remap(texture, ((su + 3) * tex_ppm).astype(np.float32),
                         ((10 - zz) * tex_ppm).astype(np.float32), cv2.INTER_LINEAR)
        img = np.repeat(np.clip(grey, 0, 255).astype(np.uint8)[..., None], 3, axis=2)
        return View(img, np.ones((h, w), bool), weight)

    monkeypatch.setattr(relief, "rectify_wall", fake)
    wall = Wall(0, 0, (0.0, 0.0), (30.0, 0.0), (0.0, -1.0), 8.0)
    cams = [Camera(x, -10.0, 1.5, 0.0, 100, 100, False, 1.0) for x in (10.0, 20.0)]
    dummy = np.zeros((1, 1, 3), np.uint8)
    return relief, wall, [(dummy, c) for c in cams]


def test_relief_finds_a_bay_and_is_the_same_swept_in_strips(monkeypatch):
    relief, wall, views = _relief_scene(monkeypatch)
    whole, why = relief.sweep(views, wall, tile_pixels=10_000_000)
    assert whole is not None, why
    strips, why = relief.sweep(views, wall, tile_pixels=4_000)
    assert strips is not None, why
    for samples in (whole, strips):
        u, v, off = samples[:, 0], samples[:, 1], samples[:, 2]
        bay = (u > 13) & (u < 17) & (v > 2.5) & (v < 5.5)
        flat = (u < 10) | (u > 20)
        assert np.median(off[bay]) == pytest.approx(0.5, abs=0.08)
        assert np.median(np.abs(off[flat])) < 0.05
    # Strip edges fall between patches: the strips agree with the whole sweep, patch for patch.
    a = {(round(float(r[0]), 2), round(float(r[1]), 2)): r[2] for r in whole}
    b = {(round(float(r[0]), 2), round(float(r[1]), 2)): r[2] for r in strips}
    common = a.keys() & b.keys()
    assert len(common) > 0.9 * len(a)
    assert np.median([abs(a[k] - b[k]) for k in common]) < 0.02


def test_exact_rectification_keeps_the_scale_it_was_asked_for():
    from smc.facades.geometry import Wall
    from smc.facades.rectify import output_size

    long_wall = Wall(0, 0, (0.0, 0.0), (85.0, 0.0), (0.0, -1.0), 112.0)
    assert output_size(long_wall, 8.0) == (640, 640)            # a texture: clamped
    assert output_size(long_wall, 8.0, exact=True) == (680, 896)  # a measurement: not
    short = Wall(0, 0, (0.0, 0.0), (4.1, 0.0), (0.0, -1.0), 6.0)
    assert output_size(short, 8.0, exact=True) == (33, 48)


def test_storey_calibration_is_scored_on_buildings_it_did_not_see():
    import importlib.util
    import pathlib

    spec = importlib.util.spec_from_file_location(
        "build_storeys", pathlib.Path(__file__).parents[1] / "scripts" / "build_storeys.py")
    storeys = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(storeys)
    rng = np.random.default_rng(1)
    n = rng.integers(1, 40, 600)
    pairs = [(float(k * 4.0 + rng.normal(0, 0.6)), int(k)) for k in n]
    cal = storeys.calibrate(pairs)
    assert cal["pooled_m"] == pytest.approx(4.0, abs=0.1)
    assert cal["validation"]["leave_one_out"]["median_ratio"] == pytest.approx(1.0, abs=0.02)
    assert cal["validation"]["flat_3_2_m"]["median_ratio"] > 1.15  # the bias it removes
    assert storeys.storey_height(cal, 300.0) > 0  # no ceiling: any height has a storey
    assert round(320.0 / storeys.storey_height(cal, 320.0)) == 80
