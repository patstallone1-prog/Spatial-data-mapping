"""Fail closed instead of writing into a stale external-drive mount directory."""

from __future__ import annotations

import plistlib
import subprocess
import uuid
from pathlib import Path


def volume_ready(volume: Path | None, expected_uuid: str | None) -> bool:
    if volume is None:
        return expected_uuid is None
    if not expected_uuid or volume.parent != Path("/Volumes") or not volume.is_mount():
        return False
    try:
        expected = uuid.UUID(expected_uuid)
        result = subprocess.run(
            ["/usr/sbin/diskutil", "info", "-plist", str(volume)],
            capture_output=True, timeout=10, check=False,
        )
        if result.returncode:
            return False
        info = plistlib.loads(result.stdout)
        return (info.get("MountPoint") == str(volume) and info.get("Internal") is False
                and uuid.UUID(info.get("VolumeUUID", "")) == expected)
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, plistlib.InvalidFileException):
        return False
