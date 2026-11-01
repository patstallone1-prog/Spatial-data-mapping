"""The storm and sewer networks the cities publish, read into one shape a drainage model can use.

What each city publishes (checked 2026-11-01, each service fetched):

* **San Jose** publishes its whole storm network (Public Works, DPW_StormwaterService): 31,836
  gravity mains with the asset at each end (UPID/DOWNID), the invert at each end, diameter,
  slope, material and install year; 29,475 manholes and 36,092 inlets with rim and invert
  elevations; discharge points, culverts, open drains, pump stations and detention areas.
  Elevations are feet (California State Plane III, NAVD 88), diameters inches. Its sanitary
  network is published only as maintenance layers and the trunk lines (DOT_SanitaryStormSewer
  layer 29), which are read as the sanitary system's backbone.
* **Palo Alto** publishes its storm drain network (StormDrain_view): 6,378 pipelines, 1,576
  manholes, 4,662 catch basins, inlets, 280 outfalls, pump stations and tide gates -- the
  geometry and type only, no inverts or sizes.
* **Berkeley** publishes its storm inlets (StormDrains_public, swInlet) and nothing of the pipes.
* **San Francisco** publishes its catch basins and inlets (DataSF jtgq-b7c5, SFPUC Wastewater
  asset registry, PDDL, refreshed daily). Its sewer is combined -- one pipe for storm and
  sanitary -- and the SFPUC does not publish the mains or manholes.
* **Oakland** publishes a storm drain dataset on its old CKAN portal only as a download page,
  and its Socrata catalogue has nothing; nothing is read.

So only San Jose's network can be routed as published; the others are where the water enters
and leaves, to be joined by the pipes a later stage infers (along the streets, falling with the
lidar ground). Every record says which, and a network with gaps says where they are.

The output (``kerbside.drainage/1``) is nodes and links, in metres:

* a **node** is a manhole, inlet, catch basin, outfall, pump station or a junction made where a
  pipe ends at nothing published; its ``rim_m`` and ``invert_m`` where the city gives them;
* a **link** is a main, culvert, open channel or trunk line from node ``up`` to node ``down``
  (the city's own ends where it gives them, else snapped to the nearest node within
  ``SNAP_M``), with inverts, diameter, slope and material where given.

:func:`to_swmm` writes the routable part as an EPA SWMM 5 input file (junctions, outfalls,
conduits, cross sections, coordinates) for a model to start from.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise

from smc.official.city_fetch import fetch
from smc.official.city_records import Record

FT = 0.3048
INCH = 0.0254
#: A pipe's end this close to a published node is that node.
SNAP_M = 3.0
SCHEMA = "kerbside.drainage/1"


@dataclass(frozen=True)
class Layer:
    """One published drainage layer, what it holds, and which of its fields say what."""

    record: Record
    role: str                     #: "link" or "node"
    kind: str                     #: gravity_main, manhole, inlet, catch_basin, outfall, ...
    system: str                   #: storm | sanitary | combined
    city: str
    coverage: tuple[float, float, float, float]   #: west, south, east, north the city covers
    fields: dict = field(default_factory=dict)    #: our name -> theirs
    units: str = "ft"             #: the elevations' unit
    diameter_units: str = "in"
    license: str = ""


SJ_STORM = "https://geo.sanjoseca.gov/server/rest/services/DPW/DPW_StormwaterService/MapServer"
SJ_SANITARY = "https://geo.sanjoseca.gov/server/rest/services/DOT/DOT_SanitaryStormSewer/MapServer"
PA_STORM = "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services/StormDrain_view/FeatureServer"
BERKELEY_STORM = "https://services1.arcgis.com/IYiCpZoSIq9lAxi8/arcgis/rest/services/StormDrains_public/FeatureServer"

SAN_JOSE = (-122.05, 37.12, -121.58, 37.47)
PALO_ALTO = (-122.20, 37.36, -122.07, 37.47)
BERKELEY = (-122.33, 37.84, -122.23, 37.91)
SAN_FRANCISCO = (-122.52, 37.70, -122.35, 37.84)

_SJ_NODE = {"id": "FACILITYID", "rim": "RIMELEV", "invert": "INVERTELEV", "ground": "DEMELEV",
            "installed": "INSTALLYEAR"}
_SJ_MAIN = {"id": "FACILITYID", "up": "UPID", "down": "DOWNID", "up_type": "UPTYPE",
            "down_type": "DOWNTYPE", "up_invert": "UPELEV",
            "down_invert": "DOWNELEV", "diameter": "DIAMETER", "slope": "SLOPE",
            "material": "MATERIAL", "installed": "INSTALLYEAR", "street": "STREETNAME"}
_SJ = dict(city="san-jose", coverage=SAN_JOSE, license="City of San José open GIS (public REST service)")
_PA = dict(city="palo-alto", coverage=PALO_ALTO, license="City of Palo Alto open GIS (public feature service)")


def _sj(layer: int, title: str, role: str, kind: str, fields: dict, system: str = "storm",
        service: str = SJ_STORM) -> Layer:
    return Layer(Record(f"drainage:{kind}", title, "arcgis", service, layer=layer), role, kind, system,
                 fields=fields, **_SJ)


def _pa(layer: int, title: str, role: str, kind: str) -> Layer:
    return Layer(Record(f"drainage:{kind}", title, "arcgis", PA_STORM, layer=layer), role, kind, "storm",
                 fields={"id": "ID", "type": "PIPETYPE"}, **_PA)


LAYERS: list[Layer] = [
    _sj(8, "Storm Gravity Mains", "link", "gravity_main", _SJ_MAIN),
    _sj(9, "Storm Culverts", "link", "culvert", _SJ_MAIN),
    _sj(10, "Storm Pressurized Mains", "link", "pressure_main", _SJ_MAIN),
    _sj(13, "Storm Open Drains", "link", "open_channel", _SJ_MAIN),
    _sj(3, "Storm Manholes", "node", "manhole", _SJ_NODE),
    _sj(2, "Storm Inlets", "node", "inlet", _SJ_NODE),
    _sj(1, "Storm Discharge Points", "node", "outfall", _SJ_NODE),
    _sj(0, "Storm Pump Stations", "node", "pump_station", _SJ_NODE),
    _sj(29, "Sanitary Trunk Lines", "link", "trunk", _SJ_MAIN, system="sanitary", service=SJ_SANITARY),
    _pa(12, "Pipelines (SD)", "link", "gravity_main"),
    _pa(13, "Surface Conveyances (SD)", "link", "open_channel"),
    _pa(4, "Manholes (SD)", "node", "manhole"),
    _pa(2, "Catch Basins (SD)", "node", "catch_basin"),
    _pa(3, "Inlets (SD)", "node", "inlet"),
    _pa(6, "Outfalls (SD)", "node", "outfall"),
    _pa(7, "Pump Stations (SD)", "node", "pump_station"),
    Layer(Record("drainage:inlet", "swInlet", "arcgis", BERKELEY_STORM, layer=0), "node", "inlet", "storm",
          city="berkeley", coverage=BERKELEY, fields={"id": "FACILITYID"},
          license="City of Berkeley open GIS (public feature service)"),
    Layer(Record("drainage:catch_basin", "Stormwater inlets, drains and catch basins", "socrata_table",
                 "jtgq-b7c5", host="data.sf.gov", geometry="location"),
          "node", "catch_basin", "combined", city="san-francisco", coverage=SAN_FRANCISCO,
          fields={"id": "puc_maximo_asset_id", "type": "drain_type", "use": "system_use_code"},
          license="PDDL 1.0 (DataSF; SFPUC Wastewater asset registry)"),
]


def layers_for(bbox: dict) -> list[Layer]:
    """The layers whose city reaches into the box."""
    return [ln for ln in LAYERS if ln.coverage[0] <= bbox["east"] and ln.coverage[2] >= bbox["west"]
            and ln.coverage[1] <= bbox["north"] and ln.coverage[3] >= bbox["south"]]


def _num(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v != 0 else None


def _metres(value, units: str) -> float | None:
    v = _num(value)
    return None if v is None else round(v * (FT if units == "ft" else 1.0), 3)


#: San Jose names a main's ends by asset type and id; each type numbers its assets on its own.
END_TYPES = {"swManhole": "manhole", "swInlet": "inlet", "swDischargePoint": "outfall",
             "swPumpStation": "pump_station"}


def _id(layer: Layer, props: dict, fallback) -> str:
    raw = props.get(layer.fields.get("id", ""))
    return f"{layer.city}:{layer.kind}:{raw if raw not in (None, '') else fallback}"


def _point(geometry: dict | None):
    if not geometry:
        return None
    if geometry.get("type") == "Point":
        return [round(geometry["coordinates"][0], 7), round(geometry["coordinates"][1], 7)]
    return None


def _lines(geometry: dict | None) -> list[list[list[float]]]:
    if not geometry:
        return []
    if geometry.get("type") == "LineString":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiLineString":
        return geometry["coordinates"]
    return []


def read_node(layer: Layer, feature: dict, n: int) -> dict | None:
    props = feature.get("properties") or {}
    p = _point(feature.get("geometry"))
    if p is None:
        return None
    f = layer.fields
    node = {"id": _id(layer, props, f"{layer.kind}-{n}"), "kind": layer.kind, "system": layer.system,
            "p": p, "source": layer.record.title}
    for ours in ("rim", "invert", "ground"):
        v = _metres(props.get(f.get(ours, "")), layer.units)
        if v is not None:
            node[f"{ours}_m"] = v
    if "rim_m" in node and "invert_m" in node and node["rim_m"] > node["invert_m"]:
        node["depth_m"] = round(node["rim_m"] - node["invert_m"], 3)
    if f.get("type") and props.get(f["type"]):
        node["type"] = props[f["type"]]
    if f.get("use") and props.get(f["use"]):
        node["system"] = {"STORM": "storm", "COMBINED": "combined", "SANITARY": "sanitary"}.get(
            str(props[f["use"]]).upper(), layer.system)
    return node


def read_links(layer: Layer, feature: dict, n: int) -> list[dict]:
    props = feature.get("properties") or {}
    f = layer.fields
    parts = [[[round(x, 7), round(y, 7)] for x, y, *_ in part] for part in _lines(feature.get("geometry"))]
    out = []
    for k, coords in enumerate(p for p in parts if len(p) >= 2):
        link = {"id": _id(layer, props, f"{layer.kind}-{n}") + (f"/{k}" if k else ""), "kind": layer.kind,
                "system": layer.system, "coords": coords, "source": layer.record.title}
        for ours in ("up", "down"):
            raw = props.get(f.get(ours, ""))
            kind = END_TYPES.get(props.get(f.get(f"{ours}_type", "")))
            if raw not in (None, "") and kind:
                link[f"{ours}_ref"] = f"{layer.city}:{kind}:{raw}"
        for ours in ("up_invert", "down_invert"):
            v = _metres(props.get(f.get(ours, "")), layer.units)
            if v is not None:
                link[f"{ours}_m"] = v
        d = _num(props.get(f.get("diameter", "")))
        if d is not None:
            link["diameter_m"] = round(d * (INCH if layer.diameter_units == "in" else FT), 3)
        for ours in ("slope", "material", "installed", "street", "type"):
            v = props.get(f.get(ours, ""))
            if v not in (None, "", "UNK", 0):
                link[ours] = v
        out.append(link)
    return out


def _dist(a, b) -> float:
    k = 111320.0
    return math.hypot((b[0] - a[0]) * k * math.cos(math.radians(a[1])), (b[1] - a[1]) * k)


class _Grid:
    def __init__(self, nodes: list[dict], cell_deg: float = 0.0002):
        self.cell = cell_deg
        self.cells: dict[tuple[int, int], list[dict]] = {}
        for node in nodes:
            self.add(node)

    def add(self, node):
        key = (int(node["p"][0] // self.cell), int(node["p"][1] // self.cell))
        self.cells.setdefault(key, []).append(node)

    def nearest(self, p, reach: float):
        i, j = int(p[0] // self.cell), int(p[1] // self.cell)
        best, best_d = None, reach
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for node in self.cells.get((i + di, j + dj), ()):
                    d = _dist(node["p"], p)
                    if d <= best_d:
                        best, best_d = node, d
        return best


def connect(nodes: list[dict], links: list[dict]) -> dict:
    """Each link's ``up`` and ``down`` node: the city's own ids where they name a published node,
    else the nearest node to that end within SNAP_M, else a junction made there. The links are
    drawn from up to down where the city says which end is which; otherwise as digitised."""
    by_id = {n["id"]: n for n in nodes}
    grid = _Grid(nodes)
    made = 0
    counts = {"by_reference": 0, "snapped": 0, "junctions": 0}
    for link in links:
        for end, coord in (("up", link["coords"][0]), ("down", link["coords"][-1])):
            ref = link.pop(f"{end}_ref", None)
            if ref in by_id:
                link[end] = ref
                counts["by_reference"] += 1
                continue
            near = grid.nearest(coord, SNAP_M)
            if near is None:
                made += 1
                near = {"id": f"junction:{made}", "kind": "junction", "system": link["system"],
                        "p": coord, "source": "pipe end with no published node"}
                nodes.append(near)
                by_id[near["id"]] = near
                grid.add(near)
                counts["junctions"] += 1
            else:
                counts["snapped"] += 1
            link[end] = near["id"]
        if "up_invert_m" not in link and by_id[link["up"]].get("invert_m") is not None:
            link["up_invert_m"] = by_id[link["up"]]["invert_m"]
        if "down_invert_m" not in link and by_id[link["down"]].get("invert_m") is not None:
            link["down_invert_m"] = by_id[link["down"]]["invert_m"]
        link["length_m"] = round(sum(_dist(a, b) for a, b in pairwise(link["coords"])), 2)
        link["routable"] = all(k in link for k in ("up_invert_m", "down_invert_m", "diameter_m"))
    return counts


def build_network(region: str, bbox: dict, *, fetcher=fetch, progress=None) -> dict:
    """The region's published drainage, read from every city that reaches into it."""
    say = progress or (lambda _m: None)
    nodes: list[dict] = []
    links: list[dict] = []
    sources = []
    for layer in layers_for(bbox):
        answer = fetcher(layer.record, bbox, say)
        before = len(nodes) + len(links)
        for n, feature in enumerate(answer.features):
            if layer.role == "node":
                node = read_node(layer, feature, n)
                if node:
                    nodes.append(node)
            else:
                links.extend(read_links(layer, feature, n))
        sources.append({"city": layer.city, "title": layer.record.title, "kind": layer.kind,
                        "system": layer.system, "locator": layer.record.locator, "layer": layer.record.layer,
                        "license": layer.license, "features": len(nodes) + len(links) - before,
                        **({"refused": answer.refused} if answer.refused else {})})
    # One node per id: a city can list an asset in two layers (an inlet that is also a manhole).
    unique: dict[str, dict] = {}
    for node in nodes:
        unique.setdefault(node["id"], node)
    nodes = list(unique.values())
    topology = connect(nodes, links)
    routable = sum(1 for ln in links if ln["routable"])
    cities = sorted({s["city"] for s in sources})
    gaps = []
    if not links:
        gaps.append("no pipes published here: only where the water enters and leaves")
    elif routable < len(links):
        gaps.append(f"{len(links) - routable} of {len(links)} links lack an invert or a diameter")
    if "san-francisco" in cities:
        gaps.append("San Francisco's combined sewer mains and manholes are not published (SFPUC)")
    return {"schema": SCHEMA, "region": region,
            "bbox": [bbox["west"], bbox["south"], bbox["east"], bbox["north"]],
            "units": "metres; elevations as published (NAVD 88 where the city says)",
            "sources": sources, "topology": topology,
            "counts": {"nodes": len(nodes), "links": len(links), "routable_links": routable},
            "gaps": gaps, "nodes": nodes, "links": links}


def to_swmm(network: dict, *, system: str = "storm", roughness: float = 0.013) -> str:
    """The routable part of one system (storm by default; a combined sewer is both) as an EPA
    SWMM 5 input file: every link with both inverts and a diameter, and the nodes it joins. An
    outfall is a node published as one, or a node no routable link leaves. Max depth is rim
    minus invert where both are known (0, which SWMM reads as up to the highest pipe's crown,
    where not)."""
    links = [ln for ln in network["links"] if ln.get("routable") and ln["system"] in (system, "combined")]
    used = {ln["up"] for ln in links} | {ln["down"] for ln in links}
    nodes = {n["id"]: n for n in network["nodes"] if n["id"] in used}
    leaving = {ln["up"] for ln in links}
    names = {nid: f"N{i}" for i, nid in enumerate(sorted(nodes))}
    out = ["[TITLE]", f"Kerbside drainage: {network['region']} (from published city records)", "",
           "[OPTIONS]", "FLOW_UNITS CMS", "INFILTRATION HORTON", "FLOW_ROUTING DYNWAVE", "",
           "[JUNCTIONS]", ";;Name Elevation MaxDepth InitDepth SurDepth Aponded"]
    outfalls = []
    for nid, node in sorted(nodes.items()):
        invert = node.get("invert_m")
        if invert is None:
            invert = min([ln["up_invert_m"] for ln in links if ln["up"] == nid]
                         + [ln["down_invert_m"] for ln in links if ln["down"] == nid])
        if node["kind"] == "outfall" or nid not in leaving:
            outfalls.append((names[nid], invert))
            continue
        depth = node.get("depth_m", 0)
        out.append(f"{names[nid]} {invert:.3f} {depth:.3f} 0 0 0")
    out += ["", "[OUTFALLS]", ";;Name Elevation Type"]
    out += [f"{name} {invert:.3f} FREE" for name, invert in outfalls]
    out += ["", "[CONDUITS]", ";;Name From To Length Roughness InOffset OutOffset"]
    xs = ["", "[XSECTIONS]", ";;Link Shape Geom1 Geom2 Geom3 Geom4 Barrels"]
    for i, link in enumerate(links):
        up, down = nodes[link["up"]], nodes[link["down"]]
        up_off = max(0.0, link["up_invert_m"] - (up.get("invert_m") or link["up_invert_m"]))
        down_off = max(0.0, link["down_invert_m"] - (down.get("invert_m") or link["down_invert_m"]))
        out.append(f"C{i} {names[link['up']]} {names[link['down']]} {max(link['length_m'], 0.1):.2f} "
                   f"{roughness} {up_off:.3f} {down_off:.3f}")
        xs.append(f"C{i} CIRCULAR {link['diameter_m']:.3f} 0 0 0 1")
    out += xs
    out += ["", "[COORDINATES]", ";;Node X Y"]
    out += [f"{names[nid]} {node['p'][0]} {node['p'][1]}" for nid, node in sorted(nodes.items())]
    return "\n".join(out) + "\n"
