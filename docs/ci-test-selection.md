# Changed-module checks for pull requests

PRs and merges to main use `tools/ci/select_tests.py` to record a test plan before any
check starts. The required check names remain `ruff`, `pytest`, and
`render audit vs baseline`; the existing protected-branch and Vercel gates still apply.
No branch-protection rule or deployment authentication setting is weakened.

The plan follows Python imports, real local JavaScript imports, dynamic Python/Node
execution, and test file/fixture reads. Tests of a module that imports changed code are
included. A small `RULES` table covers deliberate dynamic loading and generated pages.
Python scripts that merely copy frontend assets do not pull all their unrelated geometry
tests into an avatar-only edit. Mock-repository path strings are not real dependencies.

Only selected pytest files and Node test files run. The corridor audit runs only if its
own test or a dependency changes. Changed Python files are linted. An unaffected required
check reports its reason for doing no work; it never invokes empty `pytest` (which would
otherwise discover everything). A failed/missing plan fails all three required checks.
New executable files with no test ownership fail selection and must gain tests or an
explicit ownership rule; there is no fallback that silently runs unrelated modules.

Changes to shared pytest/dependency configuration affect every Python module, so those
select all Python tests. Changing a nested `conftest.py` selects its own subtree. Renames
and deletions use both the base and current file maps so an old importer is not lost.
The planner fetches only the immutable base commit if needed, rather than full history.
A plan artifact and job summary record exactly which change selected each test.

## Local reproduction

```sh
python tools/ci/select_tests.py --changed docs/avatar-builder.mjs docs/home-lobby.mjs --out build/avatar-test-plan.json
python tools/ci/run_selected.py --plan build/avatar-test-plan.json --kind python
python tools/ci/run_selected.py --plan build/avatar-test-plan.json --kind node
# Or select from a PR's actual base tree:
python tools/ci/select_tests.py --base <40-character-base-sha> --out build/test-plan.json
```

Use the CI workflow's **Run workflow → full** option for an explicit full-suite run,
or `select_tests.py --full`. PR merges do not launch it. The separate cloud-container
workflow already triggers only for cloud-module changes and retains its cloud-specific
image tests and lifecycle checks.

The selector is static, so computed runtime imports or filenames may need an ownership
rule. Keep those rules specific to the affected module. The selector regressions cover
module isolation, dependency consumers, Python/JS boundaries, asset-copy false positives,
fixtures, generated pages, deleted/renamed sources, nested test fixtures, unowned code,
shallow diffs, and safe empty/test-path handling.
