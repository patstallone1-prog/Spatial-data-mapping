"""A building as measured structure: footprint, roof, and facades with their own elements.

The renderer's building was ``archetype + height``: an extruded footprint painted with one of
a dozen window patterns chosen by type. Two houses of the same type were the same house. Here a
building is its footprint and roof, and one :class:`Facade` per wall, each carrying the
windows, doors, bays, balconies, cornices, stairs and recesses that were measured on *that*
wall -- position, width, height and depth each with the grade of the evidence behind it.

The construction functions below (a window's reveal, a bay's canted sides, a cornice's profile
swept along the eave) are shared by every building, the way a builder's methods are. None of
their numbers are: every one comes from the element being built. That is the difference between
a grammar and a catalogue.

Frames: a facade runs from its footprint edge's start vertex to its end vertex. ``u`` is
metres along it, ``v`` metres up from the facade's base, and ``n`` metres out of the wall
(positive outward; the footprint winds counter-clockwise, so outward is to the right of the
edge's direction).
"""

from __future__ import annotations

import enum
import itertools
import math
from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

from smc.geometry.base import (
    DETAIL_POLICY,
    DetailPolicy,
    GeometryFamily,
    Param,
    TriMesh,
    params_from_json,
    params_json,
    register,
)
from smc.geometry.extrusion import (
    Profile,
    ProfileKey,
    SplineExtrusion,
    rectangle_profile,
    triangulate_polygon,
)
from smc.geometry.spline import PiecewisePath


class ElementKind(enum.StrEnum):
    WINDOW = "window"
    DOOR = "door"
    STOREFRONT = "storefront"
    RECESS = "recess"
    BAY_WINDOW = "bay_window"
    BALCONY = "balcony"
    CORNICE = "cornice"
    STAIR = "stair"
    FREEFORM_PATCH = "freeform_patch"


#: Elements that cut an opening in the wall behind them.
OPENINGS = frozenset({ElementKind.WINDOW, ElementKind.DOOR, ElementKind.STOREFRONT,
                      ElementKind.RECESS})


@dataclass(frozen=True)
class FacadeElement:
    """One measured feature of one wall."""

    kind: ElementKind
    u_m: float
    v_m: float
    width_m: float
    height_m: float
    depth_m: float
    grade: str = "inferred"
    confidence: float = 0.0
    params: dict[str, Param] = field(default_factory=dict)
    evidence: tuple[str, ...] = ()
    children: tuple[FacadeElement, ...] = ()
    patch: TriMesh | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", ElementKind(self.kind))
        if self.width_m <= 0 or self.height_m <= 0:
            raise ValueError(f"{self.kind} must have a positive width and height")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be within 0..1")

    @property
    def u1(self) -> float:
        return self.u_m + self.width_m

    @property
    def v1(self) -> float:
        return self.v_m + self.height_m

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "kind": str(self.kind), "u": round(self.u_m, 3), "v": round(self.v_m, 3),
            "w": round(self.width_m, 3), "h": round(self.height_m, 3),
            "d": round(self.depth_m, 3), "grade": self.grade,
            "confidence": round(self.confidence, 3),
        }
        if self.params:
            out["params"] = params_json(self.params)
        if self.evidence:
            out["evidence"] = list(self.evidence)
        if self.children:
            out["children"] = [c.to_json() for c in self.children]
        if self.patch is not None:
            out["patch"] = self.patch.to_json()
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> FacadeElement:
        return cls(ElementKind(data["kind"]), data["u"], data["v"], data["w"], data["h"],
                   data["d"], data.get("grade", "inferred"), data.get("confidence", 0.0),
                   params_from_json(data.get("params")), tuple(data.get("evidence", ())),
                   tuple(cls.from_json(c) for c in data.get("children", ())),
                   TriMesh.from_json(data["patch"]) if "patch" in data else None)


@dataclass(frozen=True)
class Facade:
    """One wall: a footprint edge from ``base_z`` to ``top_z``, and what is on it."""

    edge: int
    start: tuple[float, float]
    end: tuple[float, float]
    base_z: float
    top_z: float
    elements: tuple[FacadeElement, ...] = ()
    grade: str = "inferred"

    @property
    def length(self) -> float:
        return float(math.dist(self.start, self.end))

    @property
    def height(self) -> float:
        return self.top_z - self.base_z

    def frame(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Origin, along (u) and outward (n) unit vectors, in plan."""
        a, b = np.asarray(self.start, dtype=np.float64), np.asarray(self.end, dtype=np.float64)
        along = (b - a) / max(self.length, 1e-12)
        outward = np.array([along[1], -along[0]])
        return a, along, outward

    def to_world(self, unv: np.ndarray) -> np.ndarray:
        """(u, n, v) facade coordinates to world (x, y, z)."""
        origin, along, outward = self.frame()
        unv = np.asarray(unv, dtype=np.float64).reshape(-1, 3)
        xy = origin + unv[:, :1] * along + unv[:, 1:2] * outward
        return np.column_stack([xy, self.base_z + unv[:, 2]])

    def to_json(self) -> dict[str, Any]:
        return {"edge": self.edge, "start": [round(v, 4) for v in self.start],
                "end": [round(v, 4) for v in self.end], "base_z": round(self.base_z, 3),
                "top_z": round(self.top_z, 3), "grade": self.grade,
                "elements": [e.to_json() for e in self.elements]}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Facade:
        return cls(int(data["edge"]), tuple(data["start"]), tuple(data["end"]),
                   float(data["base_z"]), float(data["top_z"]),
                   tuple(FacadeElement.from_json(e) for e in data.get("elements", ())),
                   data.get("grade", "inferred"))


@dataclass(frozen=True)
class Roof:
    """``flat`` at the eave, or a measured ``mesh`` (any shape) in the building's frame."""

    kind: str = "flat"
    mesh: TriMesh | None = None
    grade: str = "inferred"

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "grade": self.grade}
        if self.mesh is not None:
            out["mesh"] = self.mesh.to_json()
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Roof:
        mesh = TriMesh.from_json(data["mesh"]) if "mesh" in data else None
        return cls(data.get("kind", "flat"), mesh, data.get("grade", "inferred"))


@register
@dataclass(frozen=True)
class ParametricBuilding:
    """Footprint, roof and facades. There is no type field, deliberately."""

    family: ClassVar[GeometryFamily] = GeometryFamily.PARAMETRIC_BUILDING

    footprint: tuple[tuple[float, float], ...]
    base_z: float
    eave_z: float
    roof: Roof = field(default_factory=Roof)
    facades: tuple[Facade, ...] = ()
    storey_heights_m: tuple[float, ...] = ()
    params: dict[str, Param] = field(default_factory=dict)

    def __post_init__(self) -> None:
        ring = [tuple(map(float, p)) for p in self.footprint]
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            raise ValueError("a footprint needs three corners")
        area = _signed_area(np.asarray(ring))
        if abs(area) < 1e-6:
            raise ValueError("footprint has no area")
        if area < 0:
            ring = ring[::-1]
        object.__setattr__(self, "footprint", tuple(ring))
        if self.eave_z <= self.base_z:
            raise ValueError("eave must be above base")

    def edge(self, k: int) -> tuple[tuple[float, float], tuple[float, float]]:
        ring = self.footprint
        return ring[k], ring[(k + 1) % len(ring)]

    def plain_facade(self, k: int) -> Facade:
        a, b = self.edge(k)
        return Facade(k, a, b, self.base_z, self.eave_z)

    def facade_for(self, k: int) -> Facade:
        for facade in self.facades:
            if facade.edge == k:
                return facade
        return self.plain_facade(k)

    def validate(self) -> list[str]:
        """Measured elements that cannot all be true of one wall."""
        problems: list[str] = []
        for facade in self.facades:
            length, height = facade.length, facade.height
            for e in facade.elements:
                if e.u_m < -1e-6 or e.u1 > length + 1e-6 or e.v_m < -1e-6 or e.v1 > height + 1e-6:
                    problems.append(f"facade {facade.edge}: {e.kind} at u={e.u_m:.2f} lies "
                                    "outside its wall")
            openings = [e for e in facade.elements if e.kind in OPENINGS]
            for a, b in itertools.combinations(openings, 2):
                if a.u_m < b.u1 and b.u_m < a.u1 and a.v_m < b.v1 and b.v_m < a.v1:
                    problems.append(f"facade {facade.edge}: {a.kind} and {b.kind} overlap")
        return problems

    def material_meshes(self) -> dict[str, TriMesh]:
        """Geometry by material: ``wall``, ``glass``, ``door``, ``trim``, ``roof``."""
        parts: dict[str, list[TriMesh]] = {}

        def add(material: str, mesh: TriMesh) -> None:
            if not mesh.empty:
                parts.setdefault(material, []).append(mesh)

        for k in range(len(self.footprint)):
            facade = self.facade_for(k)
            for material, mesh in _facade_meshes(facade).items():
                add(material, mesh)
        ring = np.asarray(self.footprint)
        if self.roof.kind == "mesh" and self.roof.mesh is not None:
            add("roof", self.roof.mesh)
        else:
            tris = triangulate_polygon(ring)
            add("roof", TriMesh(np.column_stack([ring, np.full(len(ring), self.eave_z)]),
                                np.asarray(tris, dtype=np.int64)))
        return {m: TriMesh.merge(v).with_normals() for m, v in parts.items()}

    def to_mesh(self) -> TriMesh:
        return TriMesh.merge(list(self.material_meshes().values()))

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.to_mesh().bounds()

    def to_json(self) -> dict[str, Any]:
        return {"footprint": [[round(x, 4), round(y, 4)] for x, y in self.footprint],
                "base_z": round(self.base_z, 3), "eave_z": round(self.eave_z, 3),
                "roof": self.roof.to_json(), "facades": [f.to_json() for f in self.facades],
                "storey_heights_m": [round(h, 3) for h in self.storey_heights_m],
                "params": params_json(self.params)}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ParametricBuilding:
        return cls(tuple(tuple(p) for p in data["footprint"]), float(data["base_z"]),
                   float(data["eave_z"]), Roof.from_json(data.get("roof", {})),
                   tuple(Facade.from_json(f) for f in data.get("facades", ())),
                   tuple(data.get("storey_heights_m", ())), params_from_json(data.get("params")))


def _signed_area(ring: np.ndarray) -> float:
    return 0.5 * float(np.sum(ring[:, 0] * np.roll(ring[:, 1], -1)
                              - np.roll(ring[:, 0], -1) * ring[:, 1]))


# ------------------------------------------------------------ the construction grammar ----


def _quad(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> TriMesh:
    return TriMesh(np.stack([a, b, c, d]), np.array([[0, 1, 2], [0, 2, 3]]))


def wall_with_openings(width: float, height: float,
                       holes: list[tuple[float, float, float, float]]) -> TriMesh:
    """A wall rectangle in (u, v), facing +n, with rectangular holes cut out of it.

    The rectangle is cut on every hole edge into a grid and every grid cell not inside a
    hole is kept -- exact for any number and arrangement of rectangular openings.
    """
    us = sorted({0.0, width, *(min(max(h[0], 0.0), width) for h in holes),
                 *(min(max(h[2], 0.0), width) for h in holes)})
    vs = sorted({0.0, height, *(min(max(h[1], 0.0), height) for h in holes),
                 *(min(max(h[3], 0.0), height) for h in holes)})
    meshes = []
    for (u0, u1), (v0, v1) in itertools.product(itertools.pairwise(us), itertools.pairwise(vs)):
        if u1 - u0 < 1e-9 or v1 - v0 < 1e-9:
            continue
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        if any(h[0] < cu < h[2] and h[1] < cv < h[3] for h in holes):
            continue
        # (u, n, v): counter-clockwise seen from outside (+n) is u right, v up.
        meshes.append(_quad(np.array([u0, 0, v0]), np.array([u1, 0, v0]),
                            np.array([u1, 0, v1]), np.array([u0, 0, v1])))
    mesh = TriMesh.merge(meshes)
    # In (u, n, v) the outward normal of that winding is -n; flip so the wall faces +n.
    return TriMesh(mesh.vertices, mesh.faces[:, ::-1])


def opening(e: FacadeElement) -> dict[str, TriMesh]:
    """A hole's reveal and what fills it: glass for a window or shopfront, a leaf for a
    door, a back wall for a recess. ``e.depth_m`` (negative) is how far in it sits."""
    depth = min(e.depth_m, -0.02)
    u0, u1, v0, v1 = e.u_m, e.u1, e.v_m, e.v1
    reveal = TriMesh.merge([
        _quad(np.array([u0, 0, v0]), np.array([u0, depth, v0]),
              np.array([u0, depth, v1]), np.array([u0, 0, v1])),            # left jamb
        _quad(np.array([u1, 0, v1]), np.array([u1, depth, v1]),
              np.array([u1, depth, v0]), np.array([u1, 0, v0])),            # right jamb
        _quad(np.array([u0, 0, v1]), np.array([u0, depth, v1]),
              np.array([u1, depth, v1]), np.array([u1, 0, v1])),            # head
        _quad(np.array([u1, 0, v0]), np.array([u1, depth, v0]),
              np.array([u0, depth, v0]), np.array([u0, 0, v0])),            # sill
    ])
    back = _quad(np.array([u0, depth, v0]), np.array([u0, depth, v1]),
                 np.array([u1, depth, v1]), np.array([u1, depth, v0]))
    fill = {ElementKind.WINDOW: "glass", ElementKind.STOREFRONT: "glass",
            ElementKind.DOOR: "door", ElementKind.RECESS: "wall"}[e.kind]
    return {"trim": reveal, fill: back}


def bay_window(e: FacadeElement) -> dict[str, TriMesh]:
    """A bay: a prism standing ``depth`` out of the wall, its sides canted at the measured
    angle (90 degrees is a box bay), with its own openings on its front face."""
    angle = math.radians(e.params["side_angle_deg"].value if "side_angle_deg" in e.params
                         else 90.0)
    d = max(e.depth_m, 0.01)
    inset = min(d / math.tan(angle) if angle < math.pi / 2 - 1e-6 else 0.0, e.width_m * 0.45)
    plan = [(e.u_m, 0.0), (e.u_m + inset, d), (e.u1 - inset, d), (e.u1, 0.0)]
    v0, v1 = e.v_m, e.v1
    parts: dict[str, list[TriMesh]] = {"wall": [], "glass": [], "trim": [], "roof": []}
    for (pu0, pn0), (pu1, pn1) in itertools.pairwise(plan):
        face_len = math.hypot(pu1 - pu0, pn1 - pn0)
        if face_len < 1e-6:
            continue
        is_front = abs(pn0 - d) < 1e-9 and abs(pn1 - d) < 1e-9
        holes = [(c.u_m - (inset + e.u_m), c.v_m - v0, c.u1 - (inset + e.u_m), c.v1 - v0)
                 for c in e.children] if is_front else []
        local = wall_with_openings(face_len, v1 - v0, holes)
        # Place the face: its own u runs from (pu0, pn0) to (pu1, pn1), its normal outward.
        du, dn = (pu1 - pu0) / face_len, (pn1 - pn0) / face_len
        out_u, out_n = dn, -du
        lv = local.vertices
        verts = np.column_stack([pu0 + lv[:, 0] * du + lv[:, 1] * out_u,
                                 pn0 + lv[:, 0] * dn + lv[:, 1] * out_n,
                                 v0 + lv[:, 2]])
        parts["wall"].append(TriMesh(verts, local.faces))
        if is_front:
            for c in e.children:
                shifted = FacadeElement(c.kind, c.u_m - (inset + e.u_m), c.v_m - v0, c.width_m,
                                        c.height_m, c.depth_m)
                for material, mesh in opening(shifted).items():
                    mv = mesh.vertices
                    placed = np.column_stack([pu0 + mv[:, 0] * du + mv[:, 1] * out_u,
                                              pn0 + mv[:, 0] * dn + mv[:, 1] * out_n,
                                              v0 + mv[:, 2]])
                    parts.setdefault(material, []).append(TriMesh(placed, mesh.faces))
    ring = np.asarray(plan)
    tris = np.asarray(triangulate_polygon(ring), dtype=np.int64)
    top = TriMesh(np.column_stack([ring[:, 0], ring[:, 1], np.full(4, v1)]), tris)
    bottom = TriMesh(np.column_stack([ring[:, 0], ring[:, 1], np.full(4, v0)]), tris[:, ::-1])
    parts["roof"].append(_ensure_up(top))
    parts["trim"].append(_ensure_up(bottom, up=False))
    return {k: TriMesh.merge(v) for k, v in parts.items() if v}


def _ensure_up(mesh: TriMesh, up: bool = True) -> TriMesh:
    """Wind a horizontal (u, n) cap so it faces up (or down) once placed in the world.

    Wound by its (u, n, v) normal: :func:`_facade_meshes` reverses every face when it maps
    the facade frame -- a reflection of world space -- into the world, which carries a
    local +v normal to world +z. The plan polygon's own orientation says nothing either way.
    """
    n = mesh.face_normals()
    if not len(n):
        return mesh
    facing_up = n[:, 2].mean() > 0
    return mesh if facing_up == up else TriMesh(mesh.vertices, mesh.faces[:, ::-1])


def balcony(e: FacadeElement) -> dict[str, TriMesh]:
    """A slab ``depth`` deep and a guard rail swept round its free edges."""
    d = max(e.depth_m, 0.05)
    slab = e.params["slab_m"].value if "slab_m" in e.params else 0.15
    rail_h = e.params["rail_height_m"].value if "rail_height_m" in e.params else 1.0
    u0, u1, v0 = e.u_m, e.u1, e.v_m
    corners = np.array([[u0, 0, v0], [u1, 0, v0], [u1, d, v0], [u0, d, v0],
                        [u0, 0, v0 + slab], [u1, 0, v0 + slab], [u1, d, v0 + slab],
                        [u0, d, v0 + slab]])
    quads = [(0, 1, 2, 3), (4, 7, 6, 5), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    slab_mesh = TriMesh.merge([_quad(*corners[list(q[::-1])]) for q in quads])
    rail_path = PiecewisePath(np.array([[u0 + 0.02, 0.0, 0.0], [u0 + 0.02, d - 0.02, 0.0],
                                        [u1 - 0.02, d - 0.02, 0.0], [u1 - 0.02, 0.0, 0.0]]),
                              breaks=(1, 2))
    rail = SplineExtrusion(rail_path, (ProfileKey(0.0, rectangle_profile(0.04, rail_h)),),
                           caps=True).to_mesh()
    rv = rail.vertices
    rail = TriMesh(np.column_stack([rv[:, 0], rv[:, 1], v0 + slab + rv[:, 2]]), rail.faces)
    return {"trim": slab_mesh, "rail": rail}


def cornice(e: FacadeElement, facade_length: float) -> dict[str, TriMesh]:
    """A moulding swept along the wall: the measured depth and height, run the element's
    measured length. Its section can be given as a profile; otherwise a plain cavetto-ish
    step out and up to the measured depth."""
    d, h = max(e.depth_m, 0.02), e.height_m
    # (lateral = outward, up) for a path along +u; the section stands out to +n.
    section = Profile(((0.0, 0.0), (d * 0.35, h * 0.3), (d, h * 0.75), (d, h), (0.0, h)),
                      closed=True)
    path = PiecewisePath(np.array([[max(e.u_m, 0.0), 0.0, e.v_m],
                                   [min(e.u1, facade_length), 0.0, e.v_m]]))
    # Swept along +u, the extrusion's lateral axis (left of travel) is +n: out of the wall.
    return {"trim": SplineExtrusion(path, (ProfileKey(0.0, section),), caps=True).to_mesh()}


def stair(e: FacadeElement) -> dict[str, TriMesh]:
    """Steps out from the wall: the measured rise and run, ``steps`` of them."""
    steps = (int(e.params["steps"].value) if "steps" in e.params
             else max(1, round(e.height_m / 0.17)))
    rise, run = e.height_m / steps, max(e.depth_m, 0.1) / steps
    meshes = []
    for k in range(steps):
        top = e.v_m + rise * (steps - k)
        n1 = run * (k + 1)
        corners = np.array([[e.u_m, 0, e.v_m], [e.u1, 0, e.v_m], [e.u1, n1, e.v_m],
                            [e.u_m, n1, e.v_m], [e.u_m, 0, top], [e.u1, 0, top],
                            [e.u1, n1, top], [e.u_m, n1, top]])
        for q in ((5, 6, 7, 4), (3, 7, 6, 2), (2, 6, 5, 1), (0, 4, 7, 3)):
            meshes.append(_quad(*corners[list(q)]))
    return {"trim": TriMesh.merge(meshes)}


def _facade_meshes(facade: Facade) -> dict[str, TriMesh]:
    """Every surface of one wall, in world coordinates, by material."""
    parts: dict[str, list[TriMesh]] = {}
    holes = [(e.u_m, e.v_m, e.u1, e.v1) for e in facade.elements if e.kind in OPENINGS]
    local: dict[str, list[TriMesh]] = {"wall": [wall_with_openings(facade.length, facade.height,
                                                                   holes)]}
    for e in facade.elements:
        if e.kind in OPENINGS:
            built = opening(e)
        elif e.kind is ElementKind.BAY_WINDOW:
            built = bay_window(e)
        elif e.kind is ElementKind.BALCONY:
            built = balcony(e)
        elif e.kind is ElementKind.CORNICE:
            built = cornice(e, facade.length)
        elif e.kind is ElementKind.STAIR:
            built = stair(e)
        elif e.kind is ElementKind.FREEFORM_PATCH and e.patch is not None:
            built = {"wall": e.patch}
        else:
            continue
        for material, mesh in built.items():
            local.setdefault(material, []).append(mesh)
    for material, meshes in local.items():
        mesh = TriMesh.merge(meshes)
        if mesh.empty:
            continue
        # (u, n, v) -> world. The frame is left-handed (n right of u), so faces flip.
        world = facade.to_world(mesh.vertices)
        parts.setdefault(material, []).append(TriMesh(world, mesh.faces[:, ::-1]))
    return {m: TriMesh.merge(v) for m, v in parts.items()}


# ------------------------------------------------------- measured residual to elements ----


@dataclass(frozen=True)
class AppearanceField:
    """Relief too shallow to be geometry: a displacement map over the wall, metres."""

    u0: float
    v0: float
    cell_m: float
    offset_m: np.ndarray  # (rows=v, cols=u), NaN where nothing was measured

    def to_json(self) -> dict[str, Any]:
        values = np.where(np.isfinite(self.offset_m), np.round(self.offset_m * 1000), -32768)
        return {"u0": self.u0, "v0": self.v0, "cell_m": self.cell_m,
                "shape": list(self.offset_m.shape),
                "offset_mm": values.astype(int).ravel().tolist()}


def _components(mask: np.ndarray) -> list[np.ndarray]:
    """4-connected components of a boolean grid, as arrays of (row, col)."""
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    rows, cols = mask.shape
    for r0, c0 in np.argwhere(mask):
        if seen[r0, c0]:
            continue
        stack = [(int(r0), int(c0))]
        seen[r0, c0] = True
        members = []
        while stack:
            r, c = stack.pop()
            members.append((r, c))
            for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < rows and 0 <= cc < cols and mask[rr, cc] and not seen[rr, cc]:
                    seen[rr, cc] = True
                    stack.append((rr, cc))
        out.append(np.asarray(members))
    return out


def elements_from_residual(facade: Facade, samples: np.ndarray, *, cell_m: float = 0.1,
                           policy: DetailPolicy = DETAIL_POLICY, grade: str = "image",
                           evidence: tuple[str, ...] = ()
                           ) -> tuple[list[FacadeElement], AppearanceField]:
    """What the measured surface adds to a flat wall.

    ``samples`` are ``(u, v, offset, weight)`` rows: the reconstructed surface's distance out
    of (positive) or into (negative) the existing, well-placed wall plane. That difference --
    not the raw reconstruction -- is what becomes geometry, so a noisy scan can add a bay
    window to a building without moving the building.

    Each connected region deeper than the policy's threshold becomes an element, sized by its
    own extent and depth. What it is *called* is read from its shape (a region spanning the
    wall near its top is a cornice; a tall one standing well out is a bay; one set in from
    ground level is a door), and only decides its material and how it is built; its numbers
    are all its own. Everything shallower is returned as an appearance field.
    """
    s = np.asarray(samples, dtype=np.float64).reshape(-1, 4)
    cols = max(1, math.ceil(facade.length / cell_m))
    rows = max(1, math.ceil(facade.height / cell_m))
    total = np.zeros((rows, cols))
    weight = np.zeros((rows, cols))
    c = np.clip((s[:, 0] / cell_m).astype(int), 0, cols - 1)
    r = np.clip((s[:, 1] / cell_m).astype(int), 0, rows - 1)
    np.add.at(total, (r, c), s[:, 2] * s[:, 3])
    np.add.at(weight, (r, c), s[:, 3])
    offset = np.where(weight > 0, total / np.maximum(weight, 1e-12), np.nan)
    elements: list[FacadeElement] = []
    geometry_mask = np.zeros_like(offset, dtype=bool)
    for sign in (1, -1):
        mask = np.isfinite(offset) & (sign * offset >= policy.min_depth_m)
        for comp in _components(mask):
            rr, cc = comp[:, 0], comp[:, 1]
            depth = float(np.median(offset[rr, cc]))
            u0, u1 = cc.min() * cell_m, (cc.max() + 1) * cell_m
            v0, v1 = rr.min() * cell_m, (rr.max() + 1) * cell_m
            area = len(comp) * cell_m * cell_m
            kind = _name_the_shape(sign, u0, u1, v0, v1, depth, facade)
            if policy.classify(str(kind), depth, area) != "geometry":
                continue
            geometry_mask[rr, cc] = True
            sigma = float(np.std(offset[rr, cc])) if len(comp) > 1 else None
            conf = float(min(1.0, weight[rr, cc].sum() / (len(comp) * 3.0)))
            elements.append(FacadeElement(
                kind, u0, v0, min(u1, facade.length) - u0, min(v1, facade.height) - v0, depth,
                grade=grade, confidence=conf,
                params={"depth_m": Param(depth, grade, sigma, "median of the region")},
                evidence=evidence))
    appearance = np.where(geometry_mask, np.nan, offset)
    return elements, AppearanceField(0.0, 0.0, cell_m, appearance)


def _name_the_shape(sign: int, u0: float, u1: float, v0: float, v1: float, depth: float,
                    facade: Facade) -> ElementKind:
    width, height = u1 - u0, v1 - v0
    if sign > 0:
        if width >= 0.6 * facade.length and height <= 1.0 and facade.height - v1 <= 1.0:
            return ElementKind.CORNICE
        if height >= 1.2 and depth >= 0.25:
            return ElementKind.BAY_WINDOW
        if height < 0.5 and depth >= 0.4:
            return ElementKind.BALCONY
        return ElementKind.FREEFORM_PATCH
    if v0 <= 0.3 and height >= 1.8:
        return ElementKind.DOOR
    if width * height >= 0.2:
        return ElementKind.WINDOW
    return ElementKind.RECESS
