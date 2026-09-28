"""Inline the map dataset into the capture app."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from site_config import APP_URL  # noqa: E402

data = pathlib.Path("build/map_data.json").read_text()
template = pathlib.Path("tools/app_template.html").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "build/kerbside-app.html")
out.parent.mkdir(parents=True, exist_ok=True)
SUPABASE_URL = "https://tpbugonqwaoxtcswxyki.supabase.co"
# Publishable key only. It is designed to be public and the bucket is write-only, so the worst
# an exposed copy can do is add objects. Secret and service-role keys must never appear here.
SUPABASE_ANON = "sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_"

# The model the Map tab opens on. The app ships beside the viewer rather than inlining it: the
# viewer is 800 kB of code that fetches a hundred megabytes of measurements beside itself, so
# embedding it would only mean two copies of the same file. The app build writes its own copy
# of the viewer, cut with --detail app -- finer than the one the site serves, because this one
# is already on the device and has no page weight to keep to.
MODEL_SRC = "app-model.html"

out.write_text(
    template.replace("__MAP_DATA__", data)
    .replace("__SUPABASE_URL__", SUPABASE_URL)
    .replace("__SUPABASE_ANON_KEY__", SUPABASE_ANON)
    .replace("__APP_URL__", APP_URL)
    .replace("__MODEL_SRC__", MODEL_SRC)
)
print(f"{out} -> {out.stat().st_size / 1e6:.2f} MB")
