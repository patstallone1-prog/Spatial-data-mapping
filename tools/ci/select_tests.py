"""Select tests that exercise a change, without importing application code or running tests.

Python imports, local JavaScript imports and literal file references form a reverse
source graph. Small explicit ownership rules cover generated files and dynamic loading.
There is no unrelated-code fallback to the full suite: uncovered executable changes fail.
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import os
import re
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
AUDIT_TEST = "tests/test_width_vs_kerb.py"
CODE = {".py", ".mjs", ".js", ".cpp", ".h", ".cs"}


def _glob_regex(pattern: str) -> re.Pattern[str]:
    """A ruff `include` glob as a regex: `**` spans directories (none included), `*` does not."""
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(out + r"\Z")


def _lint_scope() -> list[re.Pattern[str]]:
    """The lint scope, read from the one place it is configured: pyproject's [tool.ruff]."""
    import tomllib

    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return [_glob_regex(glob) for glob in config["tool"]["ruff"]["include"]]


LINT_SCOPE = _lint_scope()


def lint_owned(path: str) -> bool:
    return any(pattern.match(path) for pattern in LINT_SCOPE)


RULES = [
    (
        ["tools/ci/**", ".github/workflows/**"],
        ["tests/test_ci_selection.py", "tests/test_ci_workflows.py"],
    ),
    (
        ["tools/unreal/**", "unreal/**"],
        ["tests/test_unreal_runtime.py", "tests/test_unreal_characters.py"],
    ),
    (["src/smc/cloud/**", "cloud/**", ".github/workflows/cloud.yml"], ["tests/test_cloud_*.py"]),
    (
        ["docs/app-regions/**", "docs/app-model.html"],
        ["tests/test_home_lobby.py", "tests/test_tunnel_app_release.py"],
    ),
    (["docs/vendor/three-0.160.0/**"], ["tests/test_renderer_boot.py"]),
]
#: Files a module reads by directory rather than by name: a change to one of them is a change to
#: each module named here, and selects those modules' consumers. The page's shell and module
#: parts are joined by smc.renderer.template (and tools/renderer-source.mjs for Node).
READ_BY_DIRECTORY = {
    "src/smc/renderer/page/": (
        "src/smc/renderer/template.py",
        "scripts/build_sf_corridor_3d.py",
        "tools/renderer-source.mjs",
    ),
}


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True)


def is_test(path: str) -> bool:
    p = PurePosixPath(path)
    return path.startswith("tests/") and (
        (p.name.startswith("test_") and p.suffix == ".py") or p.name.endswith(".test.mjs")
    )


def scope(path: str) -> str:
    p = PurePosixPath(path).parts
    if path.startswith("src/smc/"):
        return "smc." + p[2]
    if path.startswith("tools/unreal/") or path.startswith("unreal/"):
        return "unreal"
    if path.startswith("tools/ci/") or path.startswith(".github/"):
        return "ci"
    if path.startswith("docs/avatar") or path == "docs/home-lobby.mjs":
        return "avatars"
    if path.startswith("docs/") or path.startswith("scripts/build_sf_corridor"):
        return "viewer"
    return p[0] if len(p) > 1 else "shared"


class SourceGraph:
    def __init__(self, root: Path, paths: set[str], previous: dict[str, str] | None = None):
        self.root, self.paths, self.previous = root, paths, previous or {}
        self.reverse: dict[str, set[str]] = defaultdict(set)
        self.by_name: dict[str, set[str]] = defaultdict(set)
        self.modules: dict[str, str] = {}
        for p in paths:
            self.by_name[PurePosixPath(p).name].add(p)
            if p.endswith(".py"):
                mod = p.removeprefix("src/").removesuffix(".py").replace("/", ".")
                self.modules[mod.removesuffix(".__init__")] = p
        self.parse_errors: dict[str, str] = {}
        self.variables: dict[str, str] = {}

    def module(self, name: str, owner: str) -> set[str]:
        if name in self.modules:
            return {self.modules[name]}
        candidate = str(PurePosixPath(owner).parent / (name.replace(".", "/") + ".py"))
        if candidate in self.paths:
            return {candidate}
        # A missing dotted name is usually an imported function, not a script.
        if "." in name:
            return set()
        # Standalone scripts add their own directory to sys.path.
        candidates = self.by_name.get(name.rsplit(".", 1)[-1] + ".py", set())
        return set(candidates) if len(candidates) == 1 else set()

    def reference(self, value: str, owner: str) -> set[str]:
        if not value or len(value) > 400 or "\n" in value or "://" in value or "{" in value:
            return set()
        value = value.replace("\\", "/")
        candidates = {value, value.lstrip("./")}
        try:
            relative = os.path.normpath(str(PurePosixPath(owner).parent / value))
            candidates.add(relative)
        except ValueError:
            pass
        found = candidates & self.paths
        if found:
            return found
        suffix = value.lstrip("./")
        return {
            p
            for p in self.by_name.get(PurePosixPath(value).name, ())
            if p == suffix or p.endswith("/" + suffix)
        }

    def path_expr(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in {"ROOT", "REPO", "REPO_ROOT", "PROJECT_ROOT"}:
                return ""
            return self.variables.get(node.id)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            a, b = self.path_expr(node.left), self.path_expr(node.right)
            if a is not None and b is not None:
                return str(PurePosixPath(a) / b)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "Path"
            and node.args
        ):
            return self.path_expr(node.args[0])
        return None

    def dependencies(self, path: str, source: str) -> set[str]:
        deps: set[str] = set()
        if path.endswith(".py"):
            try:
                tree = ast.parse(source, filename=path)
            except SyntaxError as e:
                self.parse_errors[path] = str(e)
                return deps
            mod = path.removeprefix("src/").removesuffix(".py").replace("/", ".")
            package = (
                mod.removesuffix(".__init__")
                if mod.endswith(".__init__")
                else mod.rsplit(".", 1)[0]
            )
            self.variables = {}
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    value = self.path_expr(node.value)
                    if value is not None:
                        for target in node.targets:
                            if isinstance(target, ast.Name):
                                self.variables[target.id] = value
            literal_refs: set[str] = set()
            executed_refs: set[str] = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for a in node.names:
                        deps |= self.module(a.name, path)
                elif isinstance(node, ast.ImportFrom):
                    name = node.module or ""
                    if node.level:
                        parts = package.split(".")
                        name = ".".join(
                            parts[: len(parts) - node.level + 1] + ([name] if name else [])
                        )
                    deps |= self.module(name, path)
                    for a in node.names:
                        deps |= self.module(name + "." + a.name, path)
                elif isinstance(node, ast.For) and isinstance(node.iter, (ast.Tuple, ast.List)):
                    if any(
                        isinstance(n, ast.Attribute)
                        and n.attr in {"read_text", "read_bytes", "open"}
                        for n in ast.walk(node)
                    ):
                        for value in node.iter.elts:
                            text = self.path_expr(value)
                            if text:
                                literal_refs |= self.reference(text, path)
                elif isinstance(node, ast.Call):
                    fn = (
                        node.func.id
                        if isinstance(node.func, ast.Name)
                        else node.func.attr
                        if isinstance(node.func, ast.Attribute)
                        else ""
                    )
                    if fn in {"run", "check_output", "Popen"} and any(
                        isinstance(n, ast.Constant) and n.value == "node"
                        for arg in node.args
                        for n in ast.walk(arg)
                    ):
                        for arg in node.args:
                            for n in ast.walk(arg):
                                value = self.path_expr(n)
                                if value:
                                    executed_refs |= self.reference(value, path)
                    if fn in {
                        "Path",
                        "open",
                        "run_path",
                        "spec_from_file_location",
                        "SourceFileLoader",
                    }:
                        for arg in node.args:
                            value = self.path_expr(arg)
                            if value:
                                literal_refs |= self.reference(value, path)
                elif isinstance(node, ast.BinOp):
                    value = self.path_expr(node)
                    if value and PurePosixPath(value).suffix:
                        literal_refs |= self.reference(value, path)
            # Copying a JS/HTML asset into a Python build output does not make every
            # geometry unit test a consumer of that asset's implementation. Its own
            # tests and real JS imports own that behavior. Python dynamic code/data
            # loads and test reads still propagate normally.
            deps |= executed_refs
            deps |= {
                p
                for p in literal_refs
                if path.startswith("tests/")
                or PurePosixPath(p).suffix not in {".mjs", ".js", ".html", ".css"}
            }
        else:
            for value in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", source):
                if value.startswith("."):
                    deps |= self.reference(value, path)
            if path.endswith(".html"):
                for value in re.findall(
                    r"<(?:script|link)\b[^>]*(?:src|href)=[\"']([^\"']+)[\"']", source
                ):
                    deps |= self.reference(value, path)
            # JS tests also read fixtures/templates by literal path.
            for value in re.findall(
                r"['\"]([^'\"\n]{1,200}\.(?:py|mjs|js|html|json|yaml|yml))['\"]", source
            ):
                deps |= self.reference(value, path)
        return deps - {path}

    def build(self):
        for p in self.paths:
            if PurePosixPath(p).suffix not in {".py", ".mjs", ".js"}:
                continue
            file = self.root / p
            text = file.read_text(errors="replace") if file.is_file() else self.previous.get(p)
            if text is None:
                continue
            for dep in self.dependencies(p, text):
                self.reverse[dep].add(p)
        # Read only HTML pages actually consumed by tests, not every generated region.
        for p in sorted(self.paths):
            if p.endswith(".html") and self.reverse.get(p) and (self.root / p).is_file():
                text = (self.root / p).read_text(errors="replace")
                for dep in self.dependencies(p, text):
                    self.reverse[dep].add(p)
        return self

    def consumers(self, changed: str) -> set[str]:
        todo, found = deque([changed]), {changed}
        # Every pytest file consumes the nearest conftest, even without an import.
        if PurePosixPath(changed).name == "conftest.py":
            prefix = str(PurePosixPath(changed).parent) + "/"
            affected = {p for p in self.paths if is_test(p) and p.startswith(prefix)}
            found |= affected
            todo.extend(affected)
        while todo:
            p = todo.popleft()
            for consumer in self.reverse[p]:
                if consumer not in found:
                    found.add(consumer)
                    todo.append(consumer)
        return found


def select(root: Path, changed: list[str], paths: set[str], *, previous=None, full=False) -> dict:
    graph = SourceGraph(root, paths, previous).build()
    available = {p for p in paths if is_test(p) and (root / p).is_file()}
    reasons: dict[str, set[str]] = defaultdict(set)
    uncovered = []
    global_inputs = {"pyproject.toml", "pytest.ini", "setup.cfg", "setup.py", "requirements.txt"}
    for path in changed:
        chosen = graph.consumers(path) & available
        for prefix, readers in READ_BY_DIRECTORY.items():
            if path.startswith(prefix):
                for reader in readers:
                    chosen |= graph.consumers(reader) & available
        for prefixes, patterns in RULES:
            if any(fnmatch.fnmatchcase(path, prefix) for prefix in prefixes):
                chosen |= {
                    t for t in available if any(fnmatch.fnmatchcase(t, pat) for pat in patterns)
                }
        if path in global_inputs:
            chosen |= {t for t in available if t.endswith(".py")}
        if path in available:
            chosen.add(path)
        for t in chosen:
            reasons[t].add(path)
        if not chosen and PurePosixPath(path).suffix in CODE and (root / path).exists():
            uncovered.append(path)
    if full:
        for t in available:
            reasons[t].add("manual full suite")
        uncovered = []
    tests = sorted(reasons)
    groups: dict[str, list[str]] = defaultdict(list)
    for t in tests:
        names = sorted({scope(p) for p in reasons[t]})
        groups[" + ".join(names)].append(t)
    return {
        "schema": "kerbside.ci_test_plan/1",
        "changed": sorted(set(changed)),
        "full": full,
        "python": [t for t in tests if t.endswith(".py") and t != AUDIT_TEST],
        "node": [t for t in tests if t.endswith(".mjs")],
        "audit": AUDIT_TEST in tests,
        "visual_publish": "tests/test_visual_publish.py" in tests,
        "lint": sorted(p for p in changed if lint_owned(p) and (root / p).is_file()),
        "modules": dict(sorted(groups.items())),
        "reasons": {t: sorted(reasons[t]) for t in tests},
        "uncovered": sorted(uncovered),
        "syntax_errors": {p: e for p, e in graph.parse_errors.items() if p in changed},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--changed", nargs="*")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    paths = set(filter(None, git(root, "ls-files", "-z").split("\0")))
    previous = {}
    if args.changed is not None:
        changed = args.changed
    elif args.full:
        changed = []
    else:
        if not args.base or not re.fullmatch(r"[a-fA-F0-9]{40}", args.base):
            parser.error("a complete, immutable --base commit is required (or --changed / --full)")
        # Direct tree comparison works with shallow PR merge checkouts. Fetch only the base.
        try:
            git(root, "cat-file", "-e", args.base + "^{commit}")
        except subprocess.CalledProcessError:
            git(root, "fetch", "--no-tags", "--depth=1", "origin", args.base)
        changed = list(
            filter(
                None,
                git(root, "diff", "--no-renames", "--name-only", "-z", args.base, args.head).split(
                    "\0"
                ),
            )
        )
        old = set(filter(None, git(root, "ls-tree", "-rz", "--name-only", args.base).split("\0")))
        for p in old - paths:
            if PurePosixPath(p).suffix in {".py", ".mjs", ".js"}:
                previous[p] = git(root, "show", args.base + ":" + p)
        paths |= old
    paths |= {p for p in changed if (root / p).exists()}
    plan = select(root, changed, paths, previous=previous, full=args.full)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(plan, indent=2) + "\n")
    outputs = {
        "python": bool(plan["python"]),
        "node": bool(plan["node"]),
        "audit": plan["audit"],
        "lint": bool(plan["lint"]),
        "visual_publish": plan["visual_publish"],
    }
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.writelines(f"{k}={str(v).lower()}\n" for k, v in outputs.items())
    summary = (
        f"Selected {len(plan['python'])} Python files, {len(plan['node'])} Node files; "
        f"audit={plan['audit']}.\n"
    )
    summary += "\n".join(f"- {m}: {len(ts)} test files" for m, ts in plan["modules"].items()) + "\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write("### Changed-module test plan\n\n" + summary)
    if plan["uncovered"] or plan["syntax_errors"]:
        print(
            "Add test ownership for uncovered code: " + ", ".join(plan["uncovered"]),
            file=sys.stderr,
        )
        print(json.dumps(plan["syntax_errors"]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
