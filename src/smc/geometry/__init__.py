"""Measured geometry, in families that describe shape rather than name it.

See :mod:`smc.geometry.base` for the families and ``docs/25-geometry-compiler.md`` for how
they reach the renderer. Importing the package registers every family for deserialisation.
"""

from smc.geometry.base import (
    DETAIL_POLICY,
    DetailPolicy,
    Geometry,
    GeometryFamily,
    Param,
    TriMesh,
    geometry_from_json,
    geometry_to_json,
)
from smc.geometry.building import ElementKind, Facade, FacadeElement, ParametricBuilding, Roof
from smc.geometry.extrusion import Profile, ProfileKey, SplineExtrusion, kerb_profile
from smc.geometry.freeform import FreeformMesh, reconstruct_surface
from smc.geometry.primitives import Primitive, PrimitiveAssembly, fit_assembly
from smc.geometry.spline import CurveSamples, PathFit, PiecewisePath, fit_path, fit_paths

__all__ = [
    "DETAIL_POLICY",
    "CurveSamples",
    "DetailPolicy",
    "ElementKind",
    "Facade",
    "FacadeElement",
    "FreeformMesh",
    "Geometry",
    "GeometryFamily",
    "Param",
    "ParametricBuilding",
    "PathFit",
    "PiecewisePath",
    "Primitive",
    "PrimitiveAssembly",
    "Profile",
    "ProfileKey",
    "Roof",
    "SplineExtrusion",
    "TriMesh",
    "fit_assembly",
    "fit_path",
    "fit_paths",
    "geometry_from_json",
    "geometry_to_json",
    "kerb_profile",
    "reconstruct_surface",
]
