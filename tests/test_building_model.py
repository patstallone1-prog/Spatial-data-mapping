"""Buildings as measured structure: no house types, and no two walls forced to agree.

The renderer's building was an archetype and a height, and every house of a type had the same
windows. Here each facade carries its own measured elements, built by shared construction
functions whose every number comes from the element. The test that matters most is the first:
two buildings with completely different measured window layouts, neither drawn from a type.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from smc.geometry.base import Param
from smc.geometry.building import (
    ElementKind,
    Facade,
    FacadeElement,
    ParametricBuilding,
    elements_from_residual,
)

FOOTPRINT = ((0.0, 0.0), (10.0, 0.0), (10.0, 8.0), (0.0, 8.0))


def signed_volume(mesh) -> float:
    v, f = mesh.vertices, mesh.faces
    return float(np.einsum("ij,ij->i", v[f[:, 0]], np.cross(v[f[:, 1]], v[f[:, 2]])).sum() / 6)


def windows_on(building: ParametricBuilding) -> list[tuple[float, float, float, float]]:
    """Where the glass is: (x0, x1, z0, z1) of every glass pane on the front wall (y=0)."""
    glass = building.material_meshes().get("glass")
    if glass is None:
        return []
    panes = []
    for a in range(0, glass.triangle_count, 2):
        tri = glass.vertices[glass.faces[a:a + 2].ravel()]
        panes.append((round(float(tri[:, 0].min()), 3), round(float(tri[:, 0].max()), 3),
                      round(float(tri[:, 2].min()), 3), round(float(tri[:, 2].max()), 3)))
    return sorted(set(panes))


def test_two_buildings_have_their_own_measured_windows_and_no_type() -> None:
    three_wide = tuple(FacadeElement(ElementKind.WINDOW, u, v, 1.2, 1.6, -0.12, "image", 0.8)
                       for v in (1.0, 4.2) for u in (1.0, 4.4, 7.8))
    five_narrow = (*(FacadeElement(ElementKind.WINDOW, 0.6 + 1.9 * k, 5.0, 0.7, 2.1, -0.18,
                                   "image", 0.8) for k in range(5)),
                   FacadeElement(ElementKind.DOOR, 4.1, 0.0, 1.0, 2.4, -0.25, "image", 0.8))
    a = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(Facade(0, FOOTPRINT[0], FOOTPRINT[1],
                                                                0.0, 9.0, three_wide),))
    b = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(Facade(0, FOOTPRINT[0], FOOTPRINT[1],
                                                                0.0, 9.0, five_narrow),))
    # There is nowhere for a type to live.
    names = {f.name for f in dataclasses.fields(ParametricBuilding)}
    assert not names & {"archetype", "house_type", "type", "template", "style"}
    assert a.validate() == [] and b.validate() == []
    panes_a, panes_b = windows_on(a), windows_on(b)
    assert len(panes_a) == 6 and len(panes_b) == 5
    # Each pane is exactly where it was measured, recessed by its own depth.
    assert (1.0, 2.2, 1.0, 2.6) in panes_a and (7.8, 9.0, 4.2, 5.8) in panes_a
    assert (0.6, 1.3, 5.0, 7.1) in panes_b and (8.2, 8.9, 5.0, 7.1) in panes_b
    # The front wall faces -y, so glass set 12 cm into it sits at y = +0.12.
    glass_a = a.material_meshes()["glass"].vertices
    glass_b = b.material_meshes()["glass"].vertices
    assert np.allclose(glass_a[:, 1], 0.12) and np.allclose(glass_b[:, 1], 0.18)
    assert "door" not in a.material_meshes() and "door" in b.material_meshes()


def test_a_building_is_closed_and_faces_out() -> None:
    plain = ParametricBuilding(FOOTPRINT, 0.0, 9.0)
    assert signed_volume(plain.to_mesh()) == pytest.approx(10 * 8 * 9)
    facade = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0, (
        FacadeElement(ElementKind.WINDOW, 1, 3.5, 1.2, 1.6, -0.12),
        FacadeElement(ElementKind.BAY_WINDOW, 6.5, 3, 2.6, 3, 0.65,
                      params={"side_angle_deg": Param(45)},
                      children=(FacadeElement(ElementKind.WINDOW, 7.2, 3.5, 1.2, 1.8, -0.05),)),
    ))
    meshes = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(facade,)).material_meshes()
    wall = meshes["wall"]
    centres = wall.vertices[wall.faces].mean(axis=1)
    normals = wall.face_normals()
    front = np.abs(centres[:, 1]) < 1e-6
    assert (normals[front, 1] < -0.99).all()        # the front wall faces the street (-y)
    bay_front = np.abs(centres[:, 1] + 0.65) < 1e-6
    assert bay_front.any() and (normals[bay_front, 1] < -0.99).all()
    roof = meshes["roof"]
    assert (roof.face_normals()[:, 2] > 0.99).all()  # the flat roof and the bay's roof face up


@pytest.mark.parametrize("kind,depth", [(ElementKind.CORNICE, 0.3), (ElementKind.BALCONY, 1.0),
                                        (ElementKind.STAIR, 1.2)])
def test_projections_are_solid_and_stand_out_of_the_wall(kind, depth) -> None:
    sizes = {ElementKind.CORNICE: (0, 8.6, 10, 0.4), ElementKind.BALCONY: (1, 6.5, 2, 0.2),
             ElementKind.STAIR: (4.4, 0, 1.3, 0.9)}
    u, v, w, h = sizes[kind]
    facade = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0,
                    (FacadeElement(kind, u, v, w, h, depth),))
    meshes = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(facade,)).material_meshes()
    trim = meshes["trim"]
    assert signed_volume(trim) > 0
    assert float(trim.vertices[:, 1].min()) == pytest.approx(-depth, abs=0.03)


def test_a_bay_window_sweeps_out_at_its_measured_angle() -> None:
    bay = FacadeElement(ElementKind.BAY_WINDOW, 6.5, 3.0, 2.6, 3.0, 0.65,
                        params={"side_angle_deg": Param(45.0, "image")})
    facade = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0, (bay,))
    wall = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(facade,)).material_meshes()["wall"]
    front = wall.vertices[np.abs(wall.vertices[:, 1] + 0.65) < 1e-6]
    # Canted at 45 degrees, the front face is narrower than the bay by twice its depth.
    assert float(np.ptp(front[:, 0])) == pytest.approx(2.6 - 2 * 0.65, abs=1e-6)


def test_the_measured_surface_becomes_elements_and_the_rest_stays_texture() -> None:
    """Existing wall plane + measured residual: a bay at +0.65 m, recessed windows at -0.12 m,
    a cornice at +0.30 m, and 2 cm of brick relief that must not become triangles."""
    rng = np.random.default_rng(0)
    facade = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0)
    u, v = rng.uniform(0, 10, 40000), rng.uniform(0, 9, 40000)
    offset = 0.02 * np.sin(u * 20) * np.sin(v * 25)
    offset[(u > 6.5) & (u < 9.1) & (v > 3) & (v < 6)] = 0.65
    offset[((u > 1) & (u < 2.2) | (u > 3) & (u < 4.2)) & (v > 3.5) & (v < 5.1)] = -0.12
    offset[v > 8.6] = 0.30
    offset += rng.normal(0, 0.01, len(u))
    elements, appearance = elements_from_residual(
        facade, np.column_stack([u, v, offset, np.ones(len(u))]), evidence=("scan#7",))
    kinds = sorted(str(e.kind) for e in elements)
    assert kinds == ["bay_window", "cornice", "window", "window"]
    bay = next(e for e in elements if e.kind is ElementKind.BAY_WINDOW)
    assert (bay.u_m, bay.v_m, bay.width_m, bay.height_m) == pytest.approx((6.5, 3.0, 2.6, 3.0),
                                                                          abs=0.11)
    assert bay.depth_m == pytest.approx(0.65, abs=0.01)
    windows = [e for e in elements if e.kind is ElementKind.WINDOW]
    assert all(e.depth_m == pytest.approx(-0.12, abs=0.01) for e in windows)
    assert all(e.evidence == ("scan#7",) for e in elements)
    assert float(np.nanmax(np.abs(appearance.offset_m))) < 0.08   # the brick stays texture


def test_an_element_off_its_wall_is_caught() -> None:
    bad = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0,
                 (FacadeElement(ElementKind.WINDOW, 9.5, 3, 1.2, 1.6, -0.1),
                  FacadeElement(ElementKind.WINDOW, 1, 3, 1.2, 1.6, -0.1),
                  FacadeElement(ElementKind.DOOR, 1.5, 2, 1.0, 2.4, -0.2)))
    problems = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(bad,)).validate()
    assert any("outside its wall" in p for p in problems)
    assert any("overlap" in p for p in problems)


def test_a_building_survives_a_round_trip() -> None:
    facade = Facade(0, FOOTPRINT[0], FOOTPRINT[1], 0.0, 9.0,
                    (FacadeElement(ElementKind.WINDOW, 1, 3.5, 1.2, 1.6, -0.12, "image", 0.8,
                                   evidence=("frame:abc",)),))
    building = ParametricBuilding(FOOTPRINT, 0.0, 9.0, facades=(facade,),
                                  storey_heights_m=(3.1, 3.0, 2.9))
    back = ParametricBuilding.from_json(building.to_json())
    assert back.facades[0].elements[0].evidence == ("frame:abc",)
    assert np.allclose(back.to_mesh().vertices, building.to_mesh().vertices, atol=1e-3)
