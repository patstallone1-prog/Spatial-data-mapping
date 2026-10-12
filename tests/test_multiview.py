"""Multiview reconstruction: a known front, photographed from several places, recovered.

The views are made the way the run makes them -- each a photograph rectified onto the wall --
by casting each rectified pixel's ray from the camera through the scene: the wall with its
windows, and in front of it (or behind it) a stair or an alcove.
"""

from __future__ import annotations

import math

import numpy as np

from smc.facades import multiview as mv

WIDTH, HEIGHT, PPM = 9.0, 7.0, 30.0
WALL, WINDOW, DOOR, STAIR = 1, 8, 14, 53
WINDOWS = [(0.8, 4.2, 1.2, 1.6), (3.9, 4.2, 1.2, 1.6), (7.0, 4.2, 1.2, 1.6), (0.8, 1.0, 1.2, 1.4)]


def sideways(pu, d, pv):
    """A flight along the front, 1.2 m out, rising to the right from u=2 to a landing at 5-6.4."""
    inside = (d >= 0) & (d <= 1.2)
    flight = inside & (pu >= 2.0) & (pu < 5.0) & (pv <= 1.8 * (pu - 2.0) / 3.0)
    landing = inside & (pu >= 5.0) & (pu <= 6.4) & (pv <= 1.8)
    return flight | landing


def perpendicular(pu, d, pv):
    """A flight straight out from a door at u 4-5.2: 3.6 m out at its foot, rising to 2.0 m."""
    inside = (pu >= 4.0) & (pu <= 5.2) & (d >= 0)
    return inside & (d <= 3.6) & (pv <= 2.0 * np.clip((3.6 - d) / 2.4, 0, 1))


def render(cu: float, cn: float, scene: str, shift=(0.0, 0.0), cv: float = 2.4):
    cols = np.arange(int(WIDTH * PPM)) / PPM + 0.5 / PPM
    rows = HEIGHT - (np.arange(int(HEIGHT * PPM)) / PPM + 0.5 / PPM)
    up, vp = np.meshgrid(cols + shift[0], rows + shift[1])
    labels = np.full(up.shape, WALL, np.uint8)
    for u, v, w, h in WINDOWS:
        labels[(up >= u) & (up <= u + w) & (vp >= v) & (vp <= v + h)] = WINDOW
    door = (5.2, 1.8, 1.0, 2.1) if scene == "sideways" else (4.1, 2.0, 1.0, 2.1) if scene == "perpendicular" \
        else (3.0, 0.0, 1.0, 2.1)
    if scene != "alcove":
        u, v, w, h = door
        labels[(up >= u) & (up <= u + w) & (vp >= v) & (vp <= v + h)] = DOOR
    seen = np.zeros(up.shape, bool)
    # Where each pixel's ray ends: the surface it sees, for a texture that is the same from
    # every camera (as a real surface's is).
    hit_u, hit_d, hit_v = up.copy(), np.zeros(up.shape), vp.copy()

    def at(d):
        scale = (cn - d) / cn
        return cu + (up - cu) * scale, cv + (vp - cv) * scale

    # March from the street side toward the wall.
    if scene in {"sideways", "perpendicular"}:
        for d in np.arange(4.0, -0.001, -0.02):
            pu, pv = at(d)
            hit = (sideways if scene == "sideways" else perpendicular)(pu, d, pv) & ~seen
            labels[hit] = STAIR
            hit_u[hit], hit_d[hit], hit_v[hit] = pu[hit], d, pv[hit]
            seen |= hit
    if scene == "alcove":
        # The wall's face where there is no mouth; through the mouth, on into the alcove.
        def mouth(pu, pv):
            return (pu >= 2.8) & (pu <= 4.2) & (pv <= 2.3)
        seen |= ~mouth(*at(0.0))
        for d in np.arange(-0.02, -1.6, -0.02):
            pu, pv = at(d)
            if d > -1.2:
                hit = ~mouth(pu, pv) & ~seen       # its sides and head
                labels[hit] = WALL
            else:
                hit = ~seen                         # its back, with the door in it
                labels[hit] = np.where((pu >= 3.0) & (pu <= 4.0) & (pv <= 2.1), DOOR, WALL)[hit]
            hit_u[hit], hit_d[hit], hit_v[hit] = pu[hit], d, pv[hit]
            seen |= hit
    cell = (np.floor(hit_u * 6).astype(np.int64) * 73856093 ^ np.floor(hit_v * 6).astype(np.int64) * 19349663
            ^ np.floor(hit_d * 6).astype(np.int64) * 83492791)
    grain = (cell % 97) / 97.0 * 110
    image = np.dstack([labels * 9 % 120 + grain, labels * 23 % 120 + grain, labels * 41 % 120 + grain]).astype(np.uint8)
    return labels, image


def view(key, cu, cn, scene, shift=(0.0, 0.0)):
    labels, image = render(cu, cn, scene, shift)
    wall = {"a": [0.0, 0.0], "b": [WIDTH, 0.0], "normal": [0.0, 1.0], "height_m": HEIGHT}
    cosine = cn / math.hypot(cu - WIDTH / 2, cn)
    return mv.View(key, image, labels, WIDTH, HEIGHT, cu, cn, 2.4, PPM * cosine ** 2, {"wall": wall})


def views(scene, shift=(0.0, 0.0)):
    return [view("front", 4.5, 12.0, scene), view("left", -2.0, 12.0, scene, shift), view("right", 11.0, 12.0, scene)]


def test_views_of_one_front_register_on_its_windows_and_take_up_a_pose_error():
    ref, left = views("sideways", shift=(0.45, -0.2))[:2]
    reg = mv.register(ref, left)
    assert reg is not None and reg.method == "window_landmarks" and reg.inliers >= 3
    assert abs(reg.tx - 0.45) < 0.12 and abs(reg.ty + 0.2) < 0.12, reg


def test_a_sideways_stair_is_told_from_one_coming_straight_out():
    result = mv.reconstruct(views("sideways"), "front")
    assert result["status"] == "multiview" and result["views_registered"] == 3
    stair = max(result["stairs"], key=lambda s: s["w"])
    assert stair["orientation"] == "sideways", stair
    assert stair["rises_toward"] == 1
    assert 0.8 <= stair["width_m"] <= 1.8, stair
    assert abs(stair["run_m"] - 3.0) < 1.2, stair
    straight = mv.reconstruct(views("perpendicular"), "front")
    stair = max(straight["stairs"], key=lambda s: s["w"])
    assert stair["orientation"] == "perpendicular", stair
    assert 2.4 <= stair["run_m"] <= 4.6, stair


def test_an_alcove_is_measured_from_how_far_its_door_moves():
    result = mv.reconstruct(views("alcove"), "front")
    door = next(d for d in result["doors"] if d["depth"])
    assert -1.6 <= door["depth"]["depth_m"] <= -0.8, door


def test_a_single_view_says_so_and_changes_nothing():
    fit = {"openings": [], "primary_entry": {"kind": "flush", "u": 3.0, "w": 1.0}}
    result = mv.reconstruct(views("alcove")[:1])
    assert result["status"] == "single_view"
    assert mv.apply_to_fit(dict(fit), result) == fit


def test_the_fit_takes_the_stair_the_alcove_and_fused_openings():
    views_ = views("sideways")
    result = mv.reconstruct(views_, "front")
    fit = {"openings": [{"id": "w1", "kind": "window", "u": 3.85, "v": 4.15, "w": 1.3, "h": 1.7, "design": {"trim": {}}}],
           "primary_entry": {"kind": "long_stair", "u": 5.2, "w": 1.0, "recess": {"depth_m": 4.2}}}
    out = mv.apply_to_fit(fit, result, views_, design=lambda crop, w, h: {"shape": "standard", "vertical_bars": []})
    opening = out["openings"][0]
    assert opening["multiview"]["views"] == 3 and abs(opening["u"] - 3.9) < 0.1 and abs(opening["w"] - 1.2) < 0.1
    assert out["primary_entry"]["stair"]["orientation"] == "sideways"
    assert out["multiview_reconstruction"]["applied"]["stair"] == "sideways"
    alcove_views = views("alcove")
    alcove = mv.apply_to_fit({"openings": [], "primary_entry": {"kind": "flush", "u": 3.0, "w": 1.0}},
                             mv.reconstruct(alcove_views, "front"), alcove_views)
    assert alcove["primary_entry"]["kind"] == "flat_alcove"
    assert 0.8 <= alcove["primary_entry"]["alcove"]["depth_m"] <= 1.6


def _file_views(output, region, key, scene, keys=("front", "left", "right")):
    """The house's views as the run files them (view_store): images, labels and a manifest."""
    import json

    import cv2

    folder = output / "views" / region / key
    folder.mkdir(parents=True, exist_ok=True)
    wall = {"building_index": 0, "wall_index": 0, "a": [0.0, 0.0], "b": [WIDTH, 0.0], "normal": [0.0, 1.0],
            "height_m": HEIGHT}
    records = []
    for name, cu in (("front", 4.5), ("left", -2.0), ("right", 11.0)):
        if name not in keys:
            continue
        labels, image = render(cu, 12.0, scene)
        cv2.imwrite(str(folder / f"{name}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 98])
        cv2.imwrite(str(folder / f"{name}.labels.png"), labels)
        records.append({"key": name, "observation_uid": f"uid-{name}", "camera": {"x": cu, "y": 12.0, "z": 2.4},
                        "wall": wall, "files": {"jpg": f"{name}.jpg", "labels.png": f"{name}.labels.png"}})
    (folder / "manifest.json").write_text(json.dumps({"views": records, "view_count": len(records)}))


def test_the_matcher_reconstructs_a_house_from_its_filed_views(tmp_path):
    import runpy
    from pathlib import Path

    m = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/match_frontage_facades.py"))
    _file_views(tmp_path, "sf-mission", "7", "sideways")
    fit = {"region": "sf-mission", "openings": [], "primary_entry": {"kind": "long_stair", "u": 5.2, "w": 1.0}}
    out = m["with_multiview"](tmp_path, fit, "sf-mission", "7", "front")
    assert out["primary_entry"]["stair"]["orientation"] == "sideways"
    assert out["multiview_reconstruction"]["views_filed"] == 3
    assert list((tmp_path / "multiview" / "sf-mission").glob("7-*.json")), "kept per set of views"


def test_an_accepted_house_moves_forward_only_when_photographed_again(tmp_path):
    import json
    import runpy
    from pathlib import Path
    from types import SimpleNamespace

    m = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/match_frontage_facades.py"))
    record = {"building_id": "9", "region": "sf-mission", "observation_uid": "uid-front", "openings": [],
              "primary_entry": {"kind": "flush", "u": 3.0, "w": 1.0}, "fit_rank": [1]}
    house = tmp_path / "houses" / "sf-mission" / "9.json"
    house.parent.mkdir(parents=True)
    house.write_text(json.dumps(record))
    args = SimpleNamespace(output=tmp_path)
    _file_views(tmp_path, "sf-mission", "9", "alcove", keys=("front",))
    builds = {"9": record}
    assert m["with_multiview_upgrades"](args, builds, {"9"}) == 0, "first sighting: a baseline, nothing redone"
    assert json.loads(house.read_text()) == record
    _file_views(tmp_path, "sf-mission", "9", "alcove")
    assert m["with_multiview_upgrades"](args, builds, {"9"}) == 1, "two new photographs: moved forward"
    moved = json.loads(house.read_text())
    assert moved["primary_entry"]["kind"] == "flat_alcove"
    assert m["with_multiview_upgrades"](args, {"9": moved}, {"9"}) == 0, "nothing new: left alone"
