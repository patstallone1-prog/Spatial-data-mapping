"""A storefront sign's lettering is drawn on a canvas only as big as its letters
(docs/storefront-renderer.mjs signLettering), mapped back onto the 1536 x 256 board it always
filled: the letters land where they did, and the clear board round them costs nothing."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "docs/storefront-renderer.mjs"
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"


def test_lettering_is_trimmed_to_its_letters_and_mapped_back_onto_the_board():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = f"""
import * as S from {json.dumps(RENDERER.as_uri())};
import * as THREE from {json.dumps(THREE.as_uri())};
// A canvas whose text measures 60 px a character at 150 px, half the size above and below.
const made = [];
const canvas = () => {{ const c = {{ width: 0, height: 0, calls: [], getContext() {{ const ctx = {{
  font: '', fillStyle: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '',
  clearRect() {{}}, fillText: (t, x, y) => c.calls.push([t, x, y]),
  measureText(t) {{ const size = Number(/([0-9]+)px/.exec(ctx.font)[1]); const w = t.length * size * 0.4;
    return {{ width: w, actualBoundingBoxLeft: w / 2, actualBoundingBoxRight: w / 2,
             actualBoundingBoxAscent: size * 0.36, actualBoundingBoxDescent: size * 0.12 }}; }} }};
  return ctx; }} }}; made.push(c); return c; }};
const short = S.signLettering(THREE, 'Peets', '#fff', 700, 'Georgia', null, canvas);
const neon = S.signLettering(THREE, 'Peets', '#fff', 700, 'Georgia', '#f0f', canvas);
const long = S.signLettering(THREE, 'A'.repeat(40), '#fff', 700, 'Arial', null, canvas);
const out = (m) => ({{ board: m.userData.board, repeat: [m.repeat.x, m.repeat.y], offset: [m.offset.x, m.offset.y],
  text: made.find(c => c.width === m.userData.board.w && c.height === m.userData.board.h && c.calls.length)?.calls[0] }});
process.stdout.write(JSON.stringify({{ short: out(short), neon: out(neon), long: out(long), board: S.SIGN_BOARD }}));
"""
    r = json.loads(subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True,
                                  check=True).stdout)
    W, H = r["board"]
    assert (W, H) == (1536, 256)
    s = r["short"]
    b = s["board"]
    # Five letters at 150 px, 60 px each: 300 px wide and 72 px tall, with a 4 px margin.
    assert (b["w"], b["h"]) == (308, 80) and b["w"] * b["h"] < W * H / 15
    # The letters are drawn at the board's middle, moved into the trimmed canvas.
    assert s["text"] == ["Peets", W / 2 - b["x0"], H / 2 - b["y0"]]
    # Board UV (u, v) -> canvas texel: x = u*W - x0, row = (1-v)*H - y0, so the letters' left
    # edge (u = (W/2-150)/W) samples the canvas at its margin, and the board's middle its middle.
    u_left = (W / 2 - 150) / W
    tex_x = u_left * s["repeat"][0] + s["offset"][0]
    assert tex_x * b["w"] == pytest.approx(4)
    v_mid = 0.5
    tex_y = v_mid * s["repeat"][1] + s["offset"][1]
    assert (1 - tex_y) * b["h"] == pytest.approx(H / 2 - b["y0"])
    # A neon sign keeps room for its glow; lettering too long for the board is fitted, as before.
    assert r["neon"]["board"]["w"] > b["w"] + 40
    assert r["long"]["board"]["w"] <= W and r["long"]["board"]["x0"] >= 0
