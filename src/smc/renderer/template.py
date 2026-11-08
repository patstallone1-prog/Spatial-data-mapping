"""The viewer's page, assembled from its sources.

The page was one 38,000-line string inside ``scripts/build_sf_corridor_3d.py``. It now lives
beside this module: ``page/shell.html`` (the document, its styles and the boot script) and
``page/module/NN-*.js`` (the page's one ES module, cut at its section headers and read back in
file-name order). Assembly is concatenation and nothing else, so the page the browser runs is
exactly the page it was: one module scope, the same declaration order.

Standard library only: the deploy build (``tools/build_deploy_pages.py``) runs this on a build
machine that has Python and none of the data pipeline's packages.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[2]
PAGE_DIR = PACKAGE / "page"
SHELL = PAGE_DIR / "shell.html"
MODULE_DIR = PAGE_DIR / "module"
#: Where the module parts go in the shell: alone on a line inside ``<script type="module">``.
MODULE_MARKER = "/*@kerbside-module-parts@*/\n"
#: The data builder, whose Python the tests and the hashes still read with the page.
BUILDER = ROOT / "scripts" / "build_sf_corridor_3d.py"
#: The page's tuning, which lived in the builder until the page moved out of it.
TUNING = PACKAGE / "tuning.py"


def module_parts() -> list[Path]:
    """The module's parts in the order they are joined (their names sort into it)."""
    return sorted(MODULE_DIR.glob("*.js"))


def _stamp(paths: list[Path]) -> tuple[tuple[str, int, int], ...]:
    return tuple((str(path), path.stat().st_mtime_ns, path.stat().st_size) for path in paths)


@lru_cache(maxsize=4)
def _assemble(stamp: tuple[tuple[str, int, int], ...]) -> str:
    shell = SHELL.read_text(encoding="utf-8")
    if shell.count(MODULE_MARKER) != 1:
        raise RuntimeError(f"{SHELL} must hold {MODULE_MARKER.strip()} exactly once")
    module = "".join(Path(path).read_text(encoding="utf-8") for path, _, _ in stamp[1:])
    return shell.replace(MODULE_MARKER, module, 1)


def page_template() -> str:
    """The page as the builder used to hold it in ``HTML``, before any tuning."""
    return _assemble(_stamp([SHELL, *module_parts()]))


def renderer_files() -> list[Path]:
    """Every file the renderer is made of: the builder, its tuning, the shell and the module parts."""
    return [BUILDER, TUNING, SHELL, *module_parts()]


def renderer_source() -> str:
    """The builder's Python and the page's tuning, then the page: what reading the old single
    file gave.

    Tests and audits look things up in it by name -- a JS function, a Python rule -- and do
    not care which file now holds them."""
    return (BUILDER.read_text(encoding="utf-8") + "\n" + TUNING.read_text(encoding="utf-8")
            + "\n" + page_template())


def renderer_sha256() -> str:
    """One hash over the whole renderer, for approvals and exports that pin a revision."""
    return hashlib.sha256(renderer_source().encode("utf-8")).hexdigest()


class _RendererSource:
    """A stand-in for the old ``Path`` to the single file: ``.read_text()`` and ``.read_bytes()``
    give the assembled source, so ``SOURCE.read_text()`` keeps working where a test held one."""

    name = "build_sf_corridor_3d.py"

    def read_text(self, encoding: str = "utf-8", errors: str | None = None) -> str:
        return renderer_source()

    def read_bytes(self) -> bytes:
        return renderer_source().encode("utf-8")

    def __fspath__(self) -> str:  # for messages; the builder is the file a person opens first
        return str(BUILDER)

    def __str__(self) -> str:
        return str(BUILDER)

    @property
    def parent(self) -> Path:
        return BUILDER.parent

    @property
    def parents(self):  # whatever Path.parents is
        return BUILDER.parents


RENDERER_SOURCE = _RendererSource()
