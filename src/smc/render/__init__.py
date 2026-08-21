"""Software rendering — turning simulated geometry into actual images."""

from smc.render.png import write_png
from smc.render.raster import RenderResult, render_corridor, render_meshes

__all__ = ["RenderResult", "render_corridor", "render_meshes", "write_png"]
