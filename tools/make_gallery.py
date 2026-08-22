"""Build the standalone gallery page with images inlined as data URIs."""
from __future__ import annotations
import base64, json, pathlib, sys

gallery = pathlib.Path("build/gallery")
meta = json.loads((gallery / "meta.json").read_text())
out = pathlib.Path(sys.argv[1])

records = []
for m in meta:
    data = base64.b64encode((gallery / m["file"]).read_bytes()).decode()
    records.append({**m, "src": f"data:image/png;base64,{data}"})

payload = json.dumps(records)
template = pathlib.Path("tools/gallery_template.html").read_text()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(template.replace("__FRAME_DATA__", payload))
print(f"{out} -> {out.stat().st_size/1e6:.2f} MB, {len(records)} frames")
