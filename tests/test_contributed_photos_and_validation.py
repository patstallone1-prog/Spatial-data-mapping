"""Contributed photographs fitted like the run's, the windows behind balconies, and the HABS check."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

import numpy as np

from smc.facades.coarse_openings import assign_roles
from smc.facades.fit import windows_behind_balconies
from smc.facades.photo_rectify import rectifying_homography, vanishing_point

ROOT = Path(__file__).resolve().parents[1]


def test_the_two_vanishing_points_go_to_infinity_along_the_axes() -> None:
    # Segments converging on (500, -4000) (verticals seen from below) and on (9000, 300).
    rng = np.random.default_rng(1)
    vertical, horizontal = [], []
    for x in rng.uniform(100, 900, 30):
        y0, y1 = rng.uniform(200, 900), rng.uniform(200, 900)
        top, bottom = min(y0, y1), max(y0, y1) + 80
        t = lambda y, x=x, bottom=bottom: x + (500 - x) * (y - bottom) / (-4000 - bottom)  # noqa: E731
        vertical.append([t(bottom), bottom, t(top), top])
    for y in rng.uniform(100, 900, 30):
        x0, x1 = 100.0, 800.0
        s = lambda x, y=y, x0=x0: y + (300 - y) * (x - x0) / (9000 - x0)  # noqa: E731
        horizontal.append([x0, y, x1, s(x1)])
    vv, _ = vanishing_point(np.array(vertical))
    vh, _ = vanishing_point(np.array(horizontal))
    assert abs(vv[0] / vv[2] - 500) < 5 and abs(vv[1] / vv[2] + 4000) < 40
    H = rectifying_homography(vv, vh, (500, 500))
    for vp, axis in ((vv, 1), (vh, 0)):
        mapped = H @ vp
        assert abs(mapped[2]) < 1e-6 * np.linalg.norm(mapped) and abs(mapped[1 - axis]) < 1e-6 * np.linalg.norm(mapped)


def test_a_balcony_is_reached_through_a_french_window_behind_it() -> None:
    windows = [{"kind": "window", "u": 1.0, "v": 3.0, "w": 1.2, "h": 2.0},
               {"kind": "window", "u": 4.0, "v": 3.0, "w": 1.2, "h": 2.0}]
    balcony = {"kind": "balcony", "box": [0.05, 0.25, 0.75, 0.32], "score": 0.6}   # a balcony across two bays, 7 m up
    inferred = windows_behind_balconies(windows, [balcony], 8.0, 12.0)
    assert len(inferred) == 2 and {round(o["u"], 1) for o in inferred} == {1.0, 4.0}, "in the columns of the windows below"
    assert all(o["size_inferred"] == "french_window_behind_balcony" and o["v"] > 7 for o in inferred)
    # A window already seen behind it: nothing inferred there.
    seen = [*windows, {"kind": "window", "u": 1.0, "v": 7.4, "w": 1.2, "h": 2.0}]
    assert {round(o["u"], 1) for o in windows_behind_balconies(seen, [balcony], 8.0, 12.0)} == {4.0}
    # A railing at the ground is a fence or a stoop, not a balcony.
    assert windows_behind_balconies(windows, [{"kind": "balcony", "box": [0.1, 0.85, 0.5, 0.95], "score": 0.6}], 8.0, 12.0) == []


def test_an_arched_ground_opening_without_garage_panels_is_an_entry() -> None:
    found = [{"id": "o1", "kind": "door", "u": 4.2, "v": 0.0, "w": 1.96, "h": 2.4, "design": {"head": "arched", "panel_style": "unresolved"}},
             {"id": "o2", "kind": "door", "u": 1.0, "v": 0.0, "w": 2.6, "h": 2.3, "design": {"panel_style": "sectional_grid"}}]
    assign_roles(found, {"entries": []}, 6.5, 12.0, {"storeys": 3})
    assert found[0]["role"] == "entrance" and found[1]["role"] == "garage"


def test_the_three_francisco_houses_are_fitted_accepted_and_published() -> None:
    expected = {"263276313": "1535 Francisco Street", "263276308": "1547;1549 Francisco Street",
                "263276306": "1553;1555 Francisco Street"}
    tiler = runpy.run_path(str(ROOT / "tools/tile_frontage_fits.py"))
    contributed = tiler["contributed_fits"](ROOT / "data/contributed_houses")
    assert set(contributed) == set(expected)
    for key, address in expected.items():
        fit = contributed[key]
        assert fit["address"]["formatted"] == address and fit["auto_review"]["accept"]
        assert fit["source_locator"].startswith("contributed://") and fit["license_id"] == "contributed-by-owner"
        assert sum(o["kind"] == "window" for o in fit["openings"]) >= 6 and fit["primary_entry"]
        text = json.dumps(fit)
        assert "/Users/" not in text and "Downloads" not in text, "no local paths published"
    assert contributed["263276308"]["primary_entry"]["kind"] == "short_stair", "the two marble steps"
    assert any(c["after"]["role"] == "entrance" for c in contributed["263276306"]["review_corrections"])
    manifest = json.loads((ROOT / "docs/sf-corridor-frontage-fits.manifest.json").read_text())
    assert manifest["houses"] >= 3700


def test_the_habs_validation_is_published_with_its_coverage() -> None:
    report = json.loads((ROOT / "docs/validation/habs-2026-10-12.json").read_text())
    raw = report["results_blind_raw"]
    assert report["coverage"]["houses_scored"] == 3 and raw["drawn_openings"] == 15
    assert 0 < raw["recall"] <= 1 and 0 < raw["precision"] <= 1 and raw["centre_error_m"] < 1
    assert len(report["not_scored"]) == 9
    assert "deleted after scoring" in report["source"]
    page = (ROOT / "docs/validation/index.html").read_text()
    assert "Validation against measured drawings" in page and "habs-2026-10-12.json" in page


def test_a_full_width_ground_opening_is_the_plinth() -> None:
    fit = (ROOT / "src/smc/facades/fit.py").read_text()
    assert 'if kind != "window" and w > 0.85 * width and not controls.get("ground_floor_business"):' in fit


def test_the_stricter_blind_habs_test_is_published() -> None:
    report = json.loads((ROOT / "docs/validation/habs-blind-2026-10-13.json").read_text())
    assert report["coverage"]["houses_scored"] == len(report["houses"]) >= 5
    for house in report["houses"]:
        assert 1 <= house["photos_given"] <= 3, "a passer-by's two or three photographs"
        assert house["footprint_width_m"], "width from the footprint, never the drawing"
    best = report["results_best_photo"]
    assert best["drawn_openings"] > 0 and 0 <= best["recall"] <= 1
    assert "deleted after scoring" in report["source"]
    text = json.dumps(report)
    assert "/Users/" not in text and "build/" not in text, "no local paths published"
    page = (ROOT / "docs/validation/index.html").read_text()
    assert "habs-blind-2026-10-13.json" in page and "habs-2026-10-12.json" in page


def test_the_blind_habs_test_is_rerun_with_lidar_heights() -> None:
    report = json.loads((ROOT / "docs/validation/habs-blind-lidar-2026-10-13.json").read_text())
    runs = report["runs"]
    assert runs["lidar_detector"]["blind"] and not runs["drawn_size_detector"]["blind"]
    assert runs["lidar_detector"]["results_best_photo"]["drawn_openings"] == 113
    for house in report["houses"]:
        assert house["lidar"]["source"] == "lidar_roof_p92_over_foot", "the city's own height rule"
    text = json.dumps(report)
    assert "/Users/" not in text and "build/" not in text
    page = (ROOT / "docs/validation/index.html").read_text()
    assert "habs-blind-lidar-2026-10-13.json" in page and "habs-blind-2026-10-13.json" in page
