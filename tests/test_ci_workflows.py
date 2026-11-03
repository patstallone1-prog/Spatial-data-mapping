"""Protect the required status contexts and changed-module execution contract."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_required_status_names_and_deployment_gate_remain_consistent():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    gate = (ROOT / "tools/vercel/gate.mjs").read_text()
    for name in ["ruff", "pytest", "render audit vs baseline"]:
        assert f"name: {name}\n" in workflow
        assert f'"{name}"' in gate
    assert workflow.count("PLAN_RESULT: ${{ needs.plan.result }}") == 3
    assert workflow.count('run: test "$PLAN_RESULT" = success') == 3


def test_no_unbounded_pytest_invocation_in_pr_workflow():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "pytest -q --ignore=" not in workflow
    assert 'tools/ci/select_tests.py --base "$BASE"' in workflow
    assert "tools/ci/select_tests.py --full" in workflow
    assert "--plan test-plan.json --kind python" in workflow
    assert "--plan test-plan.json --kind node" in workflow
    assert "if: needs.plan.outputs.audit == 'true'" in workflow
    assert "pull_request:" in workflow and "workflow_dispatch:" in workflow
    assert "fetch-depth: 0" not in workflow


def test_the_plan_reads_a_sparse_checkout_and_tests_run_in_parallel():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    plan = workflow.split("\n  lint:\n")[0]
    assert "filter: blob:none" in plan and "sparse-checkout: |" in plan
    for pattern in ["*.py", "*.mjs", "*.js", "*.html", "/tests/", "/tools/"]:
        assert f"            {pattern}\n" in plan
    pyproject = (ROOT / "pyproject.toml").read_text()
    assert "pytest-xdist" in pyproject.split("dev = [")[1].split("]")[0]


def test_test_plan_artifact_is_uploaded_even_if_selection_fails():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "name: changed-module-test-plan" in workflow
    assert "if-no-files-found: error" in workflow
    assert workflow.count("uses: actions/download-artifact@v4") == 2
