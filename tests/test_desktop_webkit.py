"""Kerbside on the system's WebKit (desktop-webkit/): the shell and its measuring scripts."""

import importlib.util
import py_compile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEASURE = ROOT / "desktop-webkit/measure.py"
REPORT = ROOT / "desktop-webkit/report.py"
SHELL = ROOT / "desktop-webkit/Kerbside.swift"


def load_measure():
    spec = importlib.util.spec_from_file_location("kerbside_webkit_measure", MEASURE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_measuring_scripts_compile_and_read_process_tables() -> None:
    py_compile.compile(str(MEASURE), doraise=True)
    py_compile.compile(str(REPORT), doraise=True)
    m = load_measure()
    # ps prints cumulative CPU time as [dd-]hh:mm:ss.
    assert m.cputime_s("0:01.50") == 1.5
    assert m.cputime_s("1:02:03") == 3723
    assert m.cputime_s("1-00:00:00") == 86400
    # WebKit's helpers are told apart by the end of their command.
    kinds = {m.webkit_kind(f"/System/x/{name}") for name in m.KINDS}
    assert kinds == set(m.KINDS.values())
    assert m.webkit_kind("/Applications/Safari.app/Contents/MacOS/Safari") is None


def test_the_shell_loads_the_site_in_webkit_and_keeps_to_its_own_hosts() -> None:
    swift = SHELL.read_text()
    assert "WKWebView" in swift and "import WebKit" in swift
    assert "https://spatial-data-mapping.vercel.app/app-model.html" in swift
    assert "webViewWebContentProcessDidTerminate" in swift, "a page that dies is loaded again"
    assert "kerbsideLog" in swift, "the page's errors reach the measuring run"
    build = (ROOT / "desktop-webkit/build.sh").read_text()
    assert "app.kerbside.webkit" in build and "swiftc" in build
    ignored = (ROOT / "desktop-webkit/.gitignore").read_text().split()
    assert "out/" in ignored and "measure-*/" in ignored
