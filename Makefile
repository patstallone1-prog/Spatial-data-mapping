# Development entry points.
#
# The checks need the dev extra, which is not installed by default — a fresh clone can run the
# code without pulling a linter and a type checker it may not want.

VENV := .venv
PY   := $(VENV)/bin/python

.PHONY: install install-dev test lint typecheck check secrets deploy clean

install:
	uv venv --python 3.12
	uv pip install -e .

install-dev:
	uv pip install -e '.[dev,gcs,learned]'

test:
	PYTHONPATH=src $(PY) -m pytest tests -q

lint:
	uv run --with ruff ruff check src tests

format:
	uv run --with ruff ruff check src tests --fix

typecheck:
	uv run --with mypy mypy src

secrets:
	./tools/check_secrets.sh

deploy:
	./tools/deploy.sh "$(m)"

check: lint secrets test

clean:
	rm -rf build .pytest_cache .ruff_cache .mypy_cache
