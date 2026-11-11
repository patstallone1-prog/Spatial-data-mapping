"""Painted layers stay on top under the logarithmic depth buffer (module 00-boot)."""

from pathlib import Path

BOOT = (Path(__file__).resolve().parents[1] / "src/smc/renderer/page/module/00-boot.js").read_text(encoding="utf-8")


def test_the_polygon_offset_is_carried_into_the_written_log_depth():
    head = BOOT[: BOOT.index("const STOP_ROOF_RED")]
    # Before any material is made: the patch is the first thing after the import.
    assert "THREE.ShaderChunk.logdepthbuf_fragment = chunk.replace(" in head
    assert "gl_FragDepthEXT -= LOGDEPTH_OFFSET;" in head
    assert 'Object.defineProperty(THREE.Material.prototype, "defines"' in head
    # Only a negative offset (a layer pulled toward the eye), and only once per page.
    assert "if (!(units < 0)) return own;" in head
    assert "if (!THREE.Material.prototype.__logDepthOffset)" in head
    # The renderer still keeps the log depth buffer the patch is for.
    assert "logarithmicDepthBuffer: !META" in BOOT
