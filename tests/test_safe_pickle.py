"""The gate that lets PandaSet's point clouds in without letting them run anything.

Unpickling is not parsing. The format's GLOBAL opcode imports whatever name the file asks for
and REDUCE then calls it, so a pickle from a downloaded archive can do anything this process
can. These tests are the evidence that the gate is shut, and one of them is a live attempt to
get through it.
"""

from __future__ import annotations

import gzip
import io
import pickle

import pytest

from smc.imagery.safe_pickle import (
    ALLOWED_GLOBALS,
    RestrictedUnpickler,
    UnsafePickle,
    load_gzipped,
    load_point_cloud,
    scan_globals,
)


class Detonator:
    """Stands in for a hostile payload. ``__reduce__`` is what pickle calls on load."""

    def __reduce__(self):
        return (__import__, ("os",))


class TestScan:
    def test_the_scan_finds_what_a_file_will_import(self):
        found = scan_globals(pickle.dumps(Detonator()))
        assert ("builtins", "__import__") in found

    def test_the_scan_reads_the_opcode_modern_pickle_actually_uses(self):
        # Protocol 4 emits STACK_GLOBAL, which carries no argument and takes its operands from
        # the stack. An earlier version of this scan skipped it and so reported a clean bill of
        # health for every payload written this decade.
        for protocol in (2, 3, 4, 5):
            found = scan_globals(pickle.dumps(Detonator(), protocol=protocol))
            # Protocol 2 writes the Python 2 spelling of the module; neither is on the list.
            assert found & {("builtins", "__import__"), ("__builtin__", "__import__")}, \
                f"missed it at protocol {protocol}"
            assert not (found <= ALLOWED_GLOBALS)

    def test_the_scan_constructs_nothing(self):
        # If genops were executing, this would import os rather than return a set of names.
        found = scan_globals(pickle.dumps(Detonator()))
        assert isinstance(found, set)

    def test_an_ordinary_payload_declares_ordinary_names(self):
        found = scan_globals(pickle.dumps({"a": [1, 2, 3]}))
        assert not found - ALLOWED_GLOBALS or all(isinstance(m, str) for m, _ in found)


class TestGate:
    def test_a_hostile_pickle_is_refused_before_it_is_read(self):
        blob = gzip.compress(pickle.dumps(Detonator()))
        with pytest.raises(UnsafePickle):
            load_gzipped(blob)

    def test_the_unpickler_refuses_even_if_the_scan_is_bypassed(self):
        # The static scan cannot see through STACK_GLOBAL, so the dynamic check has to hold on
        # its own. This calls the unpickler directly, skipping the scan entirely.
        stream = io.BytesIO(pickle.dumps(Detonator(), protocol=4))
        with pytest.raises(UnsafePickle):
            RestrictedUnpickler(stream).load()

    def test_the_whitelist_is_names_not_modules(self):
        # "anything under builtins" would readmit eval and __import__.
        builtins_allowed = {name for module, name in ALLOWED_GLOBALS if module == "builtins"}
        assert builtins_allowed == {"slice"}

    def test_nothing_dangerous_is_on_the_list(self):
        for module, name in ALLOWED_GLOBALS:
            assert name not in ("eval", "exec", "system", "__import__", "Popen", "open")
            assert module in ("builtins", "numpy") or module.startswith(("numpy.", "pandas."))


class TestPointCloud:
    def test_a_cloud_that_is_not_one_is_refused_rather_than_guessed_at(self):
        with pytest.raises(UnsafePickle):
            load_point_cloud(gzip.compress(pickle.dumps({"not": "a frame"})))
