"""One storefront wall read by a vision-language model (Qwen via OpenRouter), as a reviewer
would read it, in as few tokens as will do.

Only what the registered elevation cannot give by measurement is asked for. The call sends
two small JPEGs: the fused, registered elevation with a labelled 1 m grid (for where things
are) and the best single frame on the same grid (for colours, materials and lettering). It
also sends the facts the records already hold (wall length, LiDAR height, tenants and their
record spans) and the detector's boxes as hints to correct. The answer is one compact JSON
object of arrays, capped at ``MAX_TOKENS``. Every call is cached by the hash of what was
sent, so a rerun never pays twice. A budget file stops the run at the cap.

The key is read from ``.env.local`` (``OPENROUTER_API_KEY``, git-ignored) and never logged.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
import urllib.error
import urllib.request

import cv2
import numpy as np

from ..config import LAB, OUT

MODEL = "qwen/qwen4-max"
URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_TOKENS = 900
#: the one retry of an answer cut off by MAX_TOKENS
RETRY_TOKENS = 1600
PROMPT_VERSION = "qwen-wall/3"
CACHE = OUT / "qwen" / "cache"
LEDGER = OUT / "qwen" / "spend.jsonl"
MAX_W = 1100

SYSTEM = (
    "You read building facades from rectified street photographs for a 3D city model. "
    "Answer with one JSON object only, no prose. Coordinates are metres on the grid drawn on "
    "image 1: u along the wall from its left end (u=0 at the left red line, u=L at the right "
    "red line), v up from the pavement (v=0 at the bottom red line). Only report what you can "
    "see on this wall between the red lines; use null or [] when unsure. Round to 0.05 m.")

#: the answer's shape, as an example (a description of a shape invites Qwen-VL's own
#: point-list format on busy facades)
EXAMPLE = ('{"height":7.4,"band_top":3.6,"wall":["#c9b79a","stucco","#efe8dc"],'
           '"windows":[[1.2,4.4,1.0,1.4,"rect"],[3.0,4.4,1.0,1.4,"arched"]],'
           '"pilasters":null,"belts":[[3.55,0.15,"#d3cfc6"]],"shops":[[0.0,6.5,"Example Cafe"]],'
           '"glass":[[0.3,2.6,0.4,2.8]],"doors":[[2.8,1.0]],'
           '"awnings":[[0.2,6.3,3.3,"#7a2a2a","shed",true]],'
           '"signs":[["letters",1.0,3.6,4.0,0.4,"#1f1f1f","EXAMPLE CAFE"]],"seating":[["sidewalk_strip",0.5,6.0]],"conf":0.8}')
KEYS = ("height: facade top incl. parapet; band_top: top of the ground-floor shop band; wall: [colour, "
        "material, trim colour]; windows: upper floors only [u,v,w,h,rect|arched]; pilasters: null or "
        "[[u centres],w,v0,v1,colour]; belts: horizontal bands incl. cornice [v,h,colour]; shops: ground-floor "
        "tenant spans [u0,u1,name]; glass: shop windows [u0,u1,v bottom,v top]; doors: [u,w]; awnings: "
        "[u0,u1,v top,colour,shed|retractable|dome|box|flat_canopy,is_fabric]; signs: "
        "[board|letters|blade|window_vinyl,u,v,w,h,background colour,text]; seating if visible: "
        "[sidewalk_strip|parklet|cafe_enclosure,u0,u1]; conf 0-1")
MATERIALS = "stucco|smooth_render|brick|painted_brick|wood_siding|shingle|stone|concrete|tile|metal_panel|glass"


def _key() -> str:
    for line in (LAB / ".env.local").read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("OPENROUTER_API_KEY missing from storefronts-lab/.env.local")


def spent() -> float:
    if not LEDGER.exists():
        return 0.0
    return sum(json.loads(line).get("cost", 0.0) for line in LEDGER.read_text().splitlines() if line.strip())


def grid_image(img: np.ndarray, grid, L: float, top: float, seen: np.ndarray | None = None) -> np.ndarray:
    """The elevation cropped to the wall (1 m either side, to 1.5 m above ``top``), with a 1 m
    grid labelled every metre along the bottom and every metre up the left."""
    u0, u1, v0, v1, px, _ = grid
    c0, c1 = max(0, int((-1.0 - u0) * px)), min(img.shape[1], int((L + 1.0 - u0) * px))
    r0, r1 = max(0, int((v1 - (top + 1.5)) * px)), min(img.shape[0], int((v1 - (-0.4)) * px))
    crop = np.clip(img[r0:r1, c0:c1], 0, 255).astype(np.uint8).copy()
    if seen is not None:
        crop[~seen[r0:r1, c0:c1]] = (40, 40, 40)
    k = min(2.0, MAX_W / max(1, crop.shape[1]))
    crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    s = px * k
    ox, oy = c0 / px, r0 / px

    def X(u):
        return int(round((u - u0 - ox) * s))

    def Y(v):
        return int(round((v1 - v - oy) * s))
    over = crop.copy()
    for u in range(0, int(L) + 1):
        cv2.line(over, (X(u), 0), (X(u), crop.shape[0]), (255, 255, 255), 1)
    for v in range(0, int(top + 1.5) + 1):
        cv2.line(over, (0, Y(v)), (crop.shape[1], Y(v)), (255, 255, 255), 1)
    crop = cv2.addWeighted(over, 0.35, crop, 0.65, 0)
    for u in (0.0, L):
        cv2.line(crop, (X(u), 0), (X(u), crop.shape[0]), (0, 0, 255), 2)
    cv2.line(crop, (0, Y(0)), (crop.shape[1], Y(0)), (0, 0, 255), 2)
    for u in range(0, int(L) + 1):
        cv2.putText(crop, str(u), (X(u) + 2, crop.shape[0] - 4), 0, 0.38, (0, 0, 0), 3)
        cv2.putText(crop, str(u), (X(u) + 2, crop.shape[0] - 4), 0, 0.38, (255, 255, 255), 1)
    for v in range(1, int(top + 1.5) + 1):
        cv2.putText(crop, str(v), (2, Y(v) - 2), 0, 0.38, (0, 0, 0), 3)
        cv2.putText(crop, str(v), (2, Y(v) - 2), 0, 0.38, (0, 255, 255), 1)
    return crop


def _jpeg(img: np.ndarray, q: int = 80) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return base64.b64encode(buf.tobytes()).decode()


def facts_text(L: float, lidar_h: float, tenants: list[dict], hints: list[dict]) -> str:
    t = "; ".join(f"{x.get('name') or '?'} ({x.get('category') or '?'}) u {x['u0']:.1f}-{x['u1']:.1f}" for x in tenants)
    by: dict[str, list[str]] = {}
    for b in hints[:40]:
        by.setdefault(b["kind"], []).append(f"u {b['u']:.1f}-{b['u'] + b['w']:.1f} v {b['v']:.1f}-{b['v'] + b['h']:.1f}")
    h = "; ".join(f"{k}s near " + ", ".join(v) for k, v in by.items())
    return (f"Wall length L={L:.2f} m. LiDAR roof height {lidar_h:.1f} m (a parapet can be taller). "
            f"Tenants on record: {t or 'none'}. An automatic detector suggests (may be wrong or offset): "
            f"{h or 'nothing'}. Materials: {MATERIALS}. Fields: {KEYS}. "
            f"Reply with ONE JSON object with exactly these keys, like: {EXAMPLE}")


def read_wall(elevation: np.ndarray, frame: np.ndarray, text: str, tag: str, budget: float, log=print) -> dict | None:
    """One call (or the cached answer). Returns the parsed JSON, or None on refusal/garbage."""
    imgs = [_jpeg(elevation), _jpeg(frame, 72)]
    body = {"model": MODEL, "temperature": 0, "max_tokens": MAX_TOKENS,
            "response_format": {"type": "json_object"}, "usage": {"include": True},
            # a reading, not a puzzle: qwen4-max otherwise spends the whole cap thinking
            "reasoning": {"enabled": False},
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": [
                             {"type": "text", "text": "Image 1: registered elevation with grid. Image 2: best single "
                                                      "frame on the same grid (true colours, lettering). " + text},
                             {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{imgs[0]}"}},
                             {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{imgs[1]}"}}]}]}
    h = hashlib.sha256((PROMPT_VERSION + json.dumps(body, sort_keys=True)).encode()).hexdigest()[:24]
    CACHE.mkdir(parents=True, exist_ok=True)
    if (CACHE / f"{h}.json").exists():
        return json.loads((CACHE / f"{h}.json").read_text()).get("parsed")
    if spent() >= budget:
        raise BudgetSpent(f"spend ${spent():.3f} reached the cap ${budget:.2f}")
    return _call(body, h, tag, budget, log)


def _call(body: dict, h: str, tag: str, budget: float, log, retry: bool = False) -> dict | None:
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {_key()}", "Content-Type": "application/json",
        "X-Title": "kerbfront facade reader"})
    t0 = time.time()
    for attempt in range(3):
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=180))
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            log(f"  qwen {tag}: HTTP {e.code} {msg}")
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 2:
                time.sleep(5)
                continue
            log(f"  qwen {tag}: {e}")
            return None
    usage = resp.get("usage") or {}
    choice = (resp.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    parsed = _parse(content)
    if parsed is None and not retry and choice.get("finish_reason") == "length" \
            and spent() + float(usage.get("cost") or 0) < budget:
        # a tall front with many windows outran the cap mid-object: once more with room
        _ledger(tag, resp, usage, t0, False)
        return _call({**body, "max_tokens": RETRY_TOKENS}, h, tag, budget, log, retry=True)
    if parsed is None and not retry and spent() + float(usage.get("cost") or 0) < budget:
        _ledger(tag, resp, usage, t0, False)
        body["messages"].append({"role": "assistant", "content": content[:400]})
        body["messages"].append({"role": "user", "content": "That is not the requested object. Reply now with "
                                 "only the single JSON object with keys height, band_top, wall, windows, pilasters, "
                                 "belts, shops, glass, doors, awnings, signs, seating, conf (metres on the grid)."})
        return _call(body, h, tag, budget, log, retry=True)
    _ledger(tag, resp, usage, t0, parsed is not None)
    hit = CACHE / f"{h}.json"
    hit.write_text(json.dumps({"tag": tag, "usage": usage, "content": content, "parsed": parsed}))
    return parsed


def _parse(content: str) -> dict | None:
    try:
        p = json.loads(content[content.index("{"):content.rindex("}") + 1])
    except ValueError:
        return None
    return p if isinstance(p, dict) and ("height" in p or "windows" in p) else None


def _ledger(tag, resp, usage, t0, ok) -> None:
    row = {"tag": tag, "model": resp.get("model"), "prompt_tokens": usage.get("prompt_tokens"),
           "completion_tokens": usage.get("completion_tokens"), "cost": float(usage.get("cost") or 0.0),
           "seconds": round(time.time() - t0, 1), "ok": ok, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(json.dumps(row) + "\n")


class BudgetSpent(RuntimeError):
    pass
