# syntax=docker/dockerfile:1.7
# Kerbside GPU worker: the house pipeline's frontage filter (pixel screen), facade matcher and
# materials reader, on CUDA. The same commands the Mac ran with --device mps run here with
# --device cuda (smc.cloud.stages.house_batch).
#
#   docker build -f cloud/containers/gpu.Dockerfile -t kerbside-gpu .
#   docker run --rm --gpus all kerbside-gpu selftest
#
# The torch build must match the driver the GPU host offers. torch 2.14 (the Mac's) is built
# for CUDA 13.0 at the oldest, which needs driver >= 580, so pods ask RunPod for hosts that
# run CUDA 13.0 (gpu pool's cuda_versions). TORCH_INDEX can point at another CUDA build.
FROM nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04

ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
# A pod deletes itself with runpodctl when its work is done (smc.cloud.worker.self_terminate).
# Not fatal if the download fails: the scheduler and the watchdog delete idle pods anyway.
ARG RUNPODCTL_VERSION=1.14.4
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KERBSIDE_ROOT=/app HF_HOME=/app/build/hf-cache VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3.12 python3.12-venv git ca-certificates curl tini \
      libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/* \
 && python3.12 -m venv /opt/venv \
 && (curl -fsSL -o /usr/local/bin/runpodctl \
       "https://github.com/runpod/runpodctl/releases/download/v${RUNPODCTL_VERSION}/runpodctl-linux-amd64" \
     && chmod 755 /usr/local/bin/runpodctl || echo "runpodctl not installed: pods are deleted by the scheduler")

WORKDIR /app
COPY pyproject.toml ./
# torch's CUDA wheels first, from PyTorch's index; then the pinned house stack over them.
RUN pip install --index-url "$TORCH_INDEX" torch==2.14.0 torchvision==0.29.0 \
 && mkdir -p src/smc && touch src/smc/__init__.py \
 && pip install -e ".[houses,photo-matching,cloud]" \
 && rm -rf src
COPY . .
RUN pip install --no-deps -e . && smc-cloud --help >/dev/null

RUN useradd --create-home --uid 10001 kerbside && mkdir -p /app/build && chown -R kerbside /app
USER kerbside
ENTRYPOINT ["tini", "--", "smc-cloud"]
CMD ["worker"]
