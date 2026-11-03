"""Test routing: isolated modules, shared consumers, deleted code and safe empty plans."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tools.ci.run_selected import commands
from tools.ci.select_tests import select


def project(tmp_path, files):
    for name, content in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return set(files)


def test_only_consumers_of_changed_python_module_run(tmp_path):
    paths = project(
        tmp_path,
        {
            "src/smc/lidar/ept.py": "def tile(): pass",
            "src/smc/lidar/terrain.py": "from .ept import tile",
            "src/smc/avatars/model.py": "def body(): pass",
            "tests/test_lidar.py": "from smc.lidar.terrain import tile",
            "tests/test_avatar.py": "from smc.avatars.model import body",
        },
    )
    p = select(tmp_path, ["src/smc/lidar/ept.py"], paths)
    assert p["python"] == ["tests/test_lidar.py"]
    assert not p["uncovered"]
    assert p["modules"] == {"smc.lidar": ["tests/test_lidar.py"]}


def test_relative_package_reexport_and_script_imports_are_followed(tmp_path):
    paths = project(
        tmp_path,
        {
            "src/smc/geo/__init__.py": "from .core import origin",
            "src/smc/geo/core.py": "origin=0",
            "scripts/compile_cell.py": "from smc.geo import origin",
            "tests/test_compile.py": "import compile_cell",
        },
    )
    assert select(tmp_path, ["src/smc/geo/core.py"], paths)["python"] == ["tests/test_compile.py"]


def test_js_imports_select_node_and_python_consumers(tmp_path):
    paths = project(
        tmp_path,
        {
            "docs/avatar-builder.mjs": "export const avatar=1;",
            "docs/home-lobby.mjs": "import {avatar} from './avatar-builder.mjs';",
            "tests/avatar.test.mjs": "import {avatar} from '../docs/avatar-builder.mjs';",
            "tests/test_lobby.py": (
                "from pathlib import Path\nROOT=Path('.')\nHTML=ROOT / 'docs' / 'home-lobby.mjs'"
            ),
            "tests/test_other.py": "assert True",
        },
    )
    p = select(tmp_path, ["docs/avatar-builder.mjs"], paths)
    assert p["node"] == ["tests/avatar.test.mjs"]
    assert p["python"] == ["tests/test_lobby.py"]


def test_fixture_and_deleted_source_keep_their_consumers(tmp_path):
    paths = project(
        tmp_path,
        {
            "tests/fixtures/cell.json": "{}",
            "tests/test_cell.py": "import smc.old_cell\np=open('tests/fixtures/cell.json')",
        },
    )
    paths.add("src/smc/old_cell.py")
    p = select(
        tmp_path,
        ["src/smc/old_cell.py", "tests/fixtures/cell.json"],
        paths,
        previous={"src/smc/old_cell.py": "pass"},
    )
    assert p["python"] == ["tests/test_cell.py"]
    assert p["reasons"]["tests/test_cell.py"] == ["src/smc/old_cell.py", "tests/fixtures/cell.json"]


def test_changed_test_always_runs_and_deleted_test_does_not(tmp_path):
    paths = project(tmp_path, {"tests/test_alone.py": "assert True"}) | {"tests/test_deleted.py"}
    p = select(tmp_path, ["tests/test_alone.py", "tests/test_deleted.py"], paths)
    assert p["python"] == ["tests/test_alone.py"]


def test_shared_conftest_affects_only_its_subtree(tmp_path):
    paths = project(
        tmp_path,
        {
            "tests/cloud/conftest.py": "pass",
            "tests/cloud/test_worker.py": "pass",
            "tests/test_avatar.py": "pass",
        },
    )
    assert select(tmp_path, ["tests/cloud/conftest.py"], paths)["python"] == [
        "tests/cloud/test_worker.py"
    ]


def test_explicit_dynamic_ownership_is_scoped(tmp_path):
    paths = project(
        tmp_path,
        {
            "tools/unreal/characters_setup.py": "pass",
            "tests/test_unreal_runtime.py": "pass",
            "tests/test_cloud_queue.py": "pass",
        },
    )
    assert select(tmp_path, ["tools/unreal/characters_setup.py"], paths)["python"] == [
        "tests/test_unreal_runtime.py"
    ]


def test_docs_only_does_not_silently_launch_pytest_full_suite(tmp_path):
    paths = project(tmp_path, {"docs/guide.md": "Hello", "tests/test_other.py": "pass"})
    p = select(tmp_path, ["docs/guide.md"], paths)
    assert p["python"] == p["node"] == p["uncovered"] == []
    assert commands(p, "python") == commands(p, "node") == commands(p, "lint") == []


def test_unowned_executable_and_syntax_errors_fail_closed(tmp_path):
    paths = project(tmp_path, {"src/smc/new.py": "def invalid(:", "tests/test_other.py": "pass"})
    p = select(tmp_path, ["src/smc/new.py"], paths)
    assert p["uncovered"] == ["src/smc/new.py"]
    assert "src/smc/new.py" in p["syntax_errors"]
    with pytest.raises(ValueError, match="incomplete"):
        commands(p, "python")


def test_dependency_config_and_manual_full_suite_are_explicit(tmp_path):
    paths = project(
        tmp_path, {"pyproject.toml": "", "tests/test_a.py": "pass", "tests/x.test.mjs": ""}
    )
    p = select(tmp_path, ["pyproject.toml"], paths)
    assert p["python"] == ["tests/test_a.py"] and p["node"] == []
    p = select(tmp_path, [], paths, full=True)
    assert p["python"] == ["tests/test_a.py"] and p["node"] == ["tests/x.test.mjs"]


def test_audit_is_selected_only_when_its_dependencies_change(tmp_path):
    paths = project(
        tmp_path,
        {
            "scripts/audit_corridor_render.py": "pass",
            "tests/test_width_vs_kerb.py": "p=open('scripts/audit_corridor_render.py')",
            "tests/test_avatar.py": "pass",
        },
    )
    p = select(tmp_path, ["scripts/audit_corridor_render.py"], paths)
    assert p["audit"] and not p["python"]
    assert not select(tmp_path, ["tests/test_avatar.py"], paths)["audit"]


def test_a_plan_of_several_files_runs_on_every_core(monkeypatch):
    from tools.ci import run_selected

    plan = {"schema": "kerbside.ci_test_plan/1", "python": [f"tests/test_{i}.py" for i in range(4)]}
    monkeypatch.setattr(run_selected.importlib.util, "find_spec", lambda name: object())
    assert commands(plan, "python")[0][3:7] == ["-q", "-n", "auto", "--dist"]
    assert "-n" not in commands(plan | {"python": plan["python"][:1]}, "python")[0]
    monkeypatch.setattr(run_selected.importlib.util, "find_spec", lambda name: None)
    assert "-n" not in commands(plan, "python")[0]


def test_empty_deleted_paths_and_shell_metacharacters_are_not_executed(tmp_path):
    p = {"schema": "kerbside.ci_test_plan/1", "python": ["tests/test_a space;name.py"]}
    assert commands(p, "python")[0][-1] == "tests/test_a space;name.py"
    for unsafe in ["-x", "/etc/passwd", "tests/../secrets.py"]:
        with pytest.raises(ValueError, match="paths"):
            commands(p | {"python": [unsafe]}, "python")
    with pytest.raises(ValueError):
        commands({}, "python")


def test_shallow_diff_handles_rename_and_deletion(tmp_path):
    project(tmp_path, {"src/smc/a.py": "a=1", "tests/test_a.py": "from smc.a import a"})

    def git(*args):
        return subprocess.check_output(["git", "-C", str(tmp_path), *args], text=True).strip()

    git("init", "-q")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "Test")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    (tmp_path / "src/smc/a.py").rename(tmp_path / "src/smc/b.py")
    git("add", "-A")
    git("commit", "-qm", "rename")
    out = tmp_path / "plan.json"
    tool = Path(__file__).resolve().parents[1] / "tools/ci/select_tests.py"
    result = subprocess.run(
        [sys.executable, str(tool), "--root", str(tmp_path), "--base", base, "--out", str(out)],
        check=False,
    )
    assert result.returncode == 1
    plan = json.loads(out.read_text())
    # Deleted old imports still select the affected test. New b.py needs ownership/tests.
    assert plan["python"] == ["tests/test_a.py"]
    assert plan["uncovered"] == ["src/smc/b.py"]


def test_copying_frontend_assets_does_not_select_unrelated_geometry_tests(tmp_path):
    paths = project(
        tmp_path,
        {
            "docs/avatar-builder.mjs": "export const avatar=1",
            "scripts/build_city.py": (
                "from pathlib import Path\nASSET=Path('docs/avatar-builder.mjs')"
            ),
            "tests/test_geometry.py": "import build_city",
            "tests/test_avatar.py": (
                "from pathlib import Path\nx=Path('docs/avatar-builder.mjs').read_text()"
            ),
        },
    )
    assert select(tmp_path, ["docs/avatar-builder.mjs"], paths)["python"] == [
        "tests/test_avatar.py"
    ]


def test_actual_node_executor_propagates_cross_language_dependencies(tmp_path):
    paths = project(
        tmp_path,
        {
            "docs/geometry.mjs": "export const width=1",
            "scripts/audit_geometry.py": (
                "import subprocess\nsubprocess.run(['node', 'docs/geometry.mjs'])"
            ),
            "tests/test_geometry.py": "import audit_geometry",
        },
    )
    assert select(tmp_path, ["docs/geometry.mjs"], paths)["python"] == ["tests/test_geometry.py"]


def test_html_module_imports_reach_only_page_consumers(tmp_path):
    paths = project(
        tmp_path,
        {
            "docs/avatar.mjs": "export const x=1;",
            "docs/app.html": '<script type="module" src="./avatar.mjs"></script>',
            "tests/test_page.py": "from pathlib import Path\np=Path('docs/app.html').read_text()",
            "tests/test_other.py": "pass",
        },
    )
    assert select(tmp_path, ["docs/avatar.mjs"], paths)["python"] == ["tests/test_page.py"]


def test_file_read_in_a_literal_loop_and_dot_directory_are_owned(tmp_path):
    paths = project(
        tmp_path,
        {
            ".github/workflows/custom.yml": "name: ci",
            "tests/test_custom.py": (
                "from pathlib import Path\nROOT=Path('.')\n"
                "for p in ('.github/workflows/custom.yml',):\n"
                " x=(ROOT / p).read_text()"
            ),
        },
    )
    assert select(tmp_path, [".github/workflows/custom.yml"], paths)["python"] == [
        "tests/test_custom.py"
    ]


def test_mock_repository_path_strings_are_not_real_file_reads(tmp_path):
    paths = project(
        tmp_path,
        {
            "docs/avatar.mjs": "export const x=1;",
            "tests/test_graph.py": "fake={'docs/avatar.mjs':'export const x=1'}",
            "tests/test_avatar.py": (
                "from pathlib import Path\np=Path('docs/avatar.mjs').read_text()"
            ),
        },
    )
    assert select(tmp_path, ["docs/avatar.mjs"], paths)["python"] == ["tests/test_avatar.py"]


def test_imported_function_does_not_match_an_unrelated_script_with_same_name(tmp_path):
    paths = project(
        tmp_path,
        {
            "src/smc/geo.py": "def helper(): pass",
            "scripts/helper.py": "pass",
            "tests/test_geo.py": "from smc.geo import helper",
        },
    )
    assert not select(tmp_path, ["scripts/helper.py"], paths)["python"]


def test_test_routing_preserves_the_existing_blocking_lint_scope(tmp_path):
    paths = project(
        tmp_path,
        {
            "scripts/build_sf_corridor_3d.py": "pass",
            "scripts/build_terrain.py": "pass",
            "src/smc/model.py": "pass",
            "tools/ci/select_tests.py": "pass",
            "tests/test_map.py": "pass",
        },
    )
    p = select(tmp_path, sorted(paths), paths)
    assert p["lint"] == [
        "scripts/build_terrain.py",
        "src/smc/model.py",
        "tests/test_map.py",
        "tools/ci/select_tests.py",
    ]
    assert "tests/test_map.py" in p["python"]
