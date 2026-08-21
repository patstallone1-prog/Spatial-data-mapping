"""Runtime configuration, loaded from the environment and an optional local file.

``.env.local`` is read if present and is gitignored. Values already in the environment win, so
a deployment never has its real configuration overwritten by a stray developer file.

Nothing here logs a secret. :func:`redact` exists because the temptation to print a config for
debugging is constant and a token in a log survives far longer than the debugging session.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ENV_FILE = Path(".env.local")

#: Substrings that mark a value as secret. Matching is on the variable name, not the value,
#: so a new secret is redacted the moment it is named conventionally.
_SECRET_MARKERS = ("TOKEN", "KEY", "SECRET", "PASSWORD", "CREDENTIALS")


def load_env_file(path: Path = DEFAULT_ENV_FILE, *, override: bool = False) -> dict[str, str]:
    """Read ``KEY=value`` lines into the environment. Returns what it set."""
    if not path.exists():
        return {}
    applied: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if not value:
            continue
        if override or key not in os.environ:
            os.environ[key] = value
            applied[key] = value
    return applied


def redact(name: str, value: str | None) -> str:
    """Render a config value safely for logs."""
    if value is None:
        return "<unset>"
    if any(marker in name.upper() for marker in _SECRET_MARKERS):
        return f"<set:{len(value)} chars>"
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    """Everything the pipeline reads from the environment."""

    database_url: str | None = None
    object_store_url: str | None = None
    google_cloud_project: str | None = None
    huggingface_token: str | None = None
    mapillary_token: str | None = None
    anchor_index_url: str | None = None
    #: Where captures land before upload, and where the simulator writes.
    local_data_dir: Path = Path("build/data")

    @classmethod
    def from_env(cls, *, env_file: Path | None = DEFAULT_ENV_FILE) -> Settings:
        if env_file is not None:
            load_env_file(env_file)
        return cls(
            database_url=os.environ.get("SMC_DATABASE_URL"),
            object_store_url=os.environ.get("SMC_OBJECT_STORE_URL"),
            google_cloud_project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
            huggingface_token=os.environ.get("HUGGINGFACE_TOKEN"),
            mapillary_token=os.environ.get("MAPILLARY_ACCESS_TOKEN"),
            anchor_index_url=os.environ.get("SMC_ANCHOR_INDEX_URL"),
            local_data_dir=Path(os.environ.get("SMC_LOCAL_DATA_DIR", "build/data")),
        )

    @property
    def has_remote_store(self) -> bool:
        return bool(self.object_store_url and self.object_store_url.startswith(("gs://", "s3://")))

    def describe(self) -> str:
        rows = [
            ("SMC_DATABASE_URL", self.database_url),
            ("SMC_OBJECT_STORE_URL", self.object_store_url),
            ("GOOGLE_CLOUD_PROJECT", self.google_cloud_project),
            ("HUGGINGFACE_TOKEN", self.huggingface_token),
            ("MAPILLARY_ACCESS_TOKEN", self.mapillary_token),
        ]
        return "\n".join(f"  {name:<28} {redact(name, value)}" for name, value in rows)
