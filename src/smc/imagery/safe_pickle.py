"""Reading PandaSet's point clouds without letting them run anything.

PandaSet ships its lidar sweeps as gzipped pandas pickles. Unpickling is not parsing: the
format is a small stack language whose ``GLOBAL`` opcode imports whatever name the file asks
for and whose ``REDUCE`` opcode then calls it. A pickle from a downloaded archive can therefore
do anything the process can, and "it is a well-known dataset" is not a security property.

It is also the only format the data comes in, and 399 million measured returns are the only
metric ground truth this catalogue has. So the file is read under two gates rather than
refused or trusted.

The first gate parses the opcode stream without executing it -- :func:`pickletools.genops`
walks the bytes and yields instructions, constructing nothing -- and collects every global the
file will ask to import. A sweep from this archive asks for nine, all of them numpy and pandas reconstruction
primitives plus the builtin slice that pandas uses to record which columns a block holds. Anything else and the file is rejected before a single
byte of it is interpreted.

The second gate is the unpickler itself, which refuses any import outside the same list. The
scan alone would be enough if the scan were exhaustive; the two together mean a name has to
pass a static check and then a dynamic one to be imported at all.

This is a bounded risk rather than no risk. A whitelisted constructor with a dangerous
``__reduce__`` would still get through, and none of these has one that is known to be
exploitable. That is the honest statement, and it is why the whitelist is eight names long
instead of a module prefix.
"""

from __future__ import annotations

import gzip
import io
import pickle
import pickletools

#: Every global a PandaSet lidar sweep legitimately needs. Verified against the archive by
#: scanning the opcode stream rather than by reading the devkit and hoping.
ALLOWED_GLOBALS: frozenset[tuple[str, str]] = frozenset({
    ("pandas.core.frame", "DataFrame"),
    ("pandas.core.internals.managers", "BlockManager"),
    ("pandas.core.indexes.base", "Index"),
    ("pandas.core.indexes.base", "_new_Index"),
    ("pandas.core.indexes.range", "RangeIndex"),
    ("numpy.core.multiarray", "_reconstruct"),
    ("numpy", "ndarray"),
    ("numpy", "dtype"),
    # NumPy 2 moved the reconstruction helper; both spellings appear depending on the writer.
    ("numpy._core.multiarray", "_reconstruct"),
    # pandas records which columns a block holds as a slice. Constructing one evaluates
    # nothing and reaches nothing -- but it is listed by name rather than by letting builtins
    # through, because builtins is where eval and __import__ live.
    ("builtins", "slice"),
})


class UnsafePickle(RuntimeError):
    """The file asked to import something outside the whitelist."""


def scan_globals(data: bytes) -> set[tuple[str, str]]:
    """Every ``(module, name)`` the pickle will import, without importing any of them.

    Purely static: ``genops`` yields opcodes and their arguments and never builds an object,
    so a hostile file gets read as bytes and nothing else.
    """
    found: set[tuple[str, str]] = set()
    # STACK_GLOBAL, which protocol 4 uses in place of GLOBAL, carries no argument: it takes the
    # module and the name from the two strings pushed immediately before it. Tracking the last
    # two strings pushed is enough to read those, and without it the scan silently sees nothing
    # in any modern pickle -- which is the difference between a gate and a decoration.
    recent: list[str] = []
    for opcode, argument, _position in pickletools.genops(io.BytesIO(data)):
        if opcode.name in ("GLOBAL", "INST") and isinstance(argument, str):
            module, _, name = argument.partition(" ")
            found.add((module, name))
        elif opcode.name == "STACK_GLOBAL":
            if len(recent) >= 2:
                found.add((recent[-2], recent[-1]))
            else:
                # The operands were not literals -- built from a memo or computed. Nothing can
                # be said statically, so say so rather than reporting a clean scan.
                found.add(("<unresolved>", "<unresolved>"))
        if isinstance(argument, str) and opcode.name.startswith(
            ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE", "SHORT_BINSTRING", "BINSTRING")
        ):
            recent.append(argument)
            del recent[:-4]
    return found


class _Recorder:
    """Stands in for a pandas class, remembering what it was handed and doing nothing with it.

    The sweep is a DataFrame, and the numbers in it are numpy arrays that pandas merely holds.
    Building the real DataFrame would mean adding pandas as a dependency to read six columns of
    floats -- and it would mean running pandas' own reconstruction code over bytes from a
    downloaded archive. A stub gets the arrays out and constructs nothing but numpy.
    """

    # Class-level defaults rather than slots: pickle builds most objects through
    # ``object.__new__`` and never calls ``__init__``, so an instance can arrive with none of
    # its attributes set and a slotted stub raises rather than recording anything.
    args: tuple = ()
    kwargs: dict = {}
    state = None

    def __init__(self, *args, **kwargs) -> None:
        self.args = args
        self.kwargs = kwargs

    def __setstate__(self, state) -> None:
        self.state = state

    def __reduce__(self):
        raise UnsafePickle("a stub is not re-picklable")


class RestrictedUnpickler(pickle.Unpickler):
    """Imports nothing outside :data:`ALLOWED_GLOBALS`, and no pandas class even then."""

    def find_class(self, module: str, name: str):  # noqa: D102 - see class docstring
        if (module, name) not in ALLOWED_GLOBALS:
            raise UnsafePickle(f"refusing to import {module}.{name} from a pickle")
        if module.startswith("pandas"):
            return _Recorder
        return super().find_class(module, name)


def _arrays_in(node, found: list, seen: set) -> None:
    """Every numpy array reachable from a recorded structure, depth first."""
    import numpy as np

    if id(node) in seen:
        return
    seen.add(id(node))
    if isinstance(node, np.ndarray):
        found.append(node)
        return
    if isinstance(node, _Recorder):
        _arrays_in(node.args, found, seen)
        _arrays_in(node.kwargs, found, seen)
        _arrays_in(node.state, found, seen)
        return
    if isinstance(node, dict):
        for value in node.values():
            _arrays_in(value, found, seen)
        return
    if isinstance(node, (list, tuple, set)):
        for value in node:
            _arrays_in(value, found, seen)


def load_gzipped(data: bytes):
    """Decompress and load one sweep, refusing anything that asks for an unexpected import."""
    plain = gzip.decompress(data)
    unexpected = scan_globals(plain) - ALLOWED_GLOBALS
    if unexpected:
        raise UnsafePickle(f"pickle references {sorted(unexpected)}")
    return RestrictedUnpickler(io.BytesIO(plain)).load()


def load_point_cloud(data: bytes) -> dict:
    """One sweep as ``{column: array}``, read without pandas and without running anything.

    PandaSet stores a sweep as x, y, z, intensity, timestamp and a device index, and pandas
    splits it into one block per dtype -- the five floats in one, the integer device in
    another. Each block travels with its own array of column names, so the names are recovered
    and matched to their block by width rather than assumed from a documented order. A sweep
    whose columns were written in a different order would otherwise come back with its
    coordinates silently relabelled, which is the kind of error that produces a plausible
    point cloud of somewhere else.
    """
    import numpy as np

    frame = load_gzipped(data)
    arrays: list = []
    _arrays_in(frame, arrays, set())

    labels = [a for a in arrays if a.dtype == object or a.dtype.kind in ("U", "S")]
    blocks = [a for a in arrays if a.dtype.kind in ("f", "i", "u") and a.ndim == 2]
    if not blocks:
        raise UnsafePickle("no numeric blocks in the sweep")

    rows = max(block.shape[1] for block in blocks)
    used: set[int] = set()
    cloud: dict = {}
    for block in blocks:
        if block.shape[1] != rows:
            continue
        names = None
        for i, label in enumerate(labels):
            if i in used or label.size != block.shape[0]:
                continue
            candidate = [str(v) for v in label.ravel().tolist()]
            # The frame also carries a combined index naming every column; a block's own
            # names are the ones whose count matches its width and that have not been
            # claimed by an earlier block.
            if any(name in cloud for name in candidate):
                continue
            names, _ = candidate, used.add(i)
            break
        if names is None:
            names = [f"c{len(cloud) + i}" for i in range(block.shape[0])]
        for i, name in enumerate(names):
            cloud[name] = np.asarray(block[i])
    if not cloud:
        raise UnsafePickle("no usable columns in the sweep")
    return cloud
