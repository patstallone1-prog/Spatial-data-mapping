"""Which properties are fenced (smc.parks.fencing, tools/build_property_fences.py)."""
import importlib.util
import json
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

from smc.parks import fencing as F

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_property_fences", ROOT / "tools" / "build_property_fences.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def test_what_a_property_is_decides_its_fence():
    school = F.classify("city_land", category="Unified School District", name="MARINA MIDDLE SCHOOL")
    assert (school.verdict, school.style, school.height_m) == (F.FENCED, "chain_link", 1.83)
    # The district's offices are buildings, not yards.
    assert F.classify("city_land", category="Unified School District", name="LOMBARD STREET GARAGE").verdict == F.BUILDING_ONLY
    # A park is fenced only where a fence was surveyed: never by rule.
    park = F.classify("city_land", category="Recreation & Park", name="MOSCONE PLAYGROUND")
    assert park.verdict == F.EVIDENCE and park.style is None
    assert F.classify("city_land", category="PUC/Water", name="LOMBARD RESERVOIR").height_m == 2.44
    assert F.classify("city_land", category="Fire", name="FIRE STATION #16").verdict == F.BUILDING_ONLY
    assert F.classify("city_land", category="MTA", name="KIRKLAND YARD").verdict == F.FENCED
    assert F.classify("city_land", category="Port", name="PORT LANDS").verdict == F.OPEN
    # A car park: closed to the public is fenced, for customers or anyone is open, a garage is a building.
    assert F.classify("osm", tags={"amenity": "parking", "access": "private"}).verdict == F.FENCED
    assert F.classify("osm", tags={"amenity": "parking", "access": "customers"}).verdict == F.OPEN
    assert F.classify("osm", tags={"amenity": "parking"}).verdict == F.OPEN
    assert F.classify("osm", tags={"amenity": "parking", "parking": "multi-storey"}).verdict == F.BUILDING_ONLY
    assert F.classify("osm", tags={"amenity": "kindergarten"}).style == "picket"
    assert F.classify("school").verdict == F.FENCED


def _square(x, y, w, h):
    return Polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def test_evidence_is_joined_to_the_property_it_stands_on():
    park = {"id": "park", "name": "Park", "verdict": F.classify("city_land", category="Recreation & Park"), "polygon": _square(0, 0, 100, 80), "source": "city_land"}
    bare = {"id": "bare", "name": "Bare park", "verdict": F.classify("city_land", category="Recreation & Park"), "polygon": _square(300, 0, 50, 50), "source": "city_land"}
    school = {"id": "school", "name": "School", "verdict": F.classify("school"), "polygon": _square(0, 200, 80, 60), "source": "school"}
    lot_open = {"id": "lot", "name": "", "verdict": F.classify("osm", tags={"amenity": "parking"}), "polygon": _square(200, 200, 40, 30), "source": "osm"}
    lot_in_school = {"id": "staff", "name": "", "verdict": F.classify("osm", tags={"amenity": "parking"}), "polygon": _square(10, 210, 20, 15), "source": "osm"}
    fences = [
        {"line": LineString([(0, 0.5), (100, 0.5)]), "style": "bars", "height_m": 1.5, "src": "rpd:1"},        # the park's south side only
        {"line": LineString([(0, 200.4), (80, 200.4)]), "style": "bars", "height_m": 2.0, "src": "osm:way/2"},  # on the school's line
        {"line": LineString([(200, 200), (240, 200), (240, 230)]), "style": "chain_link", "height_m": None, "src": "osm:way/3"},  # round the lot
    ]
    gates = [{"point": Point(40, 0.5), "width_m": 3.0, "src": "rpd:9"}, {"point": Point(500, 500), "width_m": 1.2, "src": "osm:node/1"}]
    out = {r["id"]: r for r in F.assemble([park, bare, school, lot_open, lot_in_school], fences, gates)}
    # The park: its one surveyed side, with the gate recorded on it; nothing on the other three.
    assert out["park"]["verdict"] == F.EVIDENCE and [r["src"] for r in out["park"]["runs"]] == ["rpd:1"]
    assert [g["src"] for g in out["park"]["gates"]] == ["rpd:9"] and out["park"]["gates"][0]["width_m"] == 3.0
    assert "fence" not in out["park"]
    # A park with no fence recorded is open.
    assert out["bare"]["verdict"] == F.OPEN and "runs" not in out["bare"]
    # The school's line is fenced whole; the fence recorded on it says what it is made of.
    assert out["school"]["verdict"] == F.FENCED and out["school"]["fence"] == {"style": "bars", "height_m": 2.0}
    assert "runs" not in out["school"]
    # A car park with a mapped fence round it is drawn as mapped; one inside the school is the school's.
    assert out["lot"]["verdict"] == F.EVIDENCE and out["lot"]["basis"] == "car_park_fence_as_mapped"
    assert "staff" not in out


def test_the_tool_builds_the_record_from_its_snapshots():
    data = {name: tool.load_snapshot(name) for name in [*tool.SOURCES, "osm"]}
    built = tool.build(data)
    shipped = json.loads((ROOT / "docs" / "property-fences.json").read_text())
    assert built["counts"] == shipped["counts"]
    assert len(built["properties"]) == len(shipped["properties"])
    verdicts = built["counts"]["verdicts"]
    assert verdicts["school:fenced"] > 150 and verdicts["park:evidence"] > 80 and verdicts["park:open"] > 50
    assert verdicts["parking:open"] > verdicts["parking:fenced"] > 0
    manifest = json.loads((ROOT / "data" / "sf_fences" / "manifest.json").read_text())
    assert {s["name"] for s in manifest["sources"]} == {*tool.SOURCES, "osm"}
