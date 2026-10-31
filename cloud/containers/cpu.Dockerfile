# syntax=docker/dockerfile:1.7
# Kerbside CPU worker and controller: geographic cell ingestion and compilation (discover, OSM,
# terrain, lidar, imagery, city records, build, audit), the parity gate, publication, and the
# interior engine's house batches and restaurant rounds (shapely, trimesh: the interiors extra).
#
#   docker build -f cloud/containers/cpu.Dockerfile -t kerbside-cpu .
#   docker run --rm kerbside-cpu selftest          # the whole lifecycle, inside the image
#
# Linux, x86-64. Nothing here is macOS-only: the local supervisors' pmset/caffeinate/diskutil
# calls are replaced by the controller (smc.cloud), not carried over.
FROM python:3.12.7-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KERBSIDE_ROOT=/app HF_HOME=/app/build/hf-cache
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ git ca-certificates curl tini libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
# Node runs the renderer's own modules (tests, tools/build_app_worlds.py's page checks).
COPY --from=node:22.11.0-bookworm-slim /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# Dependencies first, so a code change does not reinstall them.
COPY pyproject.toml ./
RUN mkdir -p src/smc && touch src/smc/__init__.py \
 && pip install -e ".[dev,nature,curb-photo,cloud,interiors,worldmesh]" \
 && rm -rf src
COPY . .
RUN pip install --no-deps -e . && smc-cloud --help >/dev/null

# Workers run as an unprivileged user; /app is theirs to restore checkpoints into.
RUN useradd --create-home --uid 10001 kerbside && mkdir -p /app/build && chown -R kerbside /app
USER kerbside
ENTRYPOINT ["tini", "--", "smc-cloud"]
CMD ["worker"]
