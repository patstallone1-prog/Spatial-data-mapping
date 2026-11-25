"""Thin the keyframes of a moves GLB (tools/avatars/build_moves.py's output) without changing how it
plays: the exporter samples every bone at every frame, and most of those keys lie on the straight
(or, for a rotation, the shortest-arc) line between their neighbours. A key is dropped wherever the
line from the last kept key to the next would pass within ``tolerance`` of it -- 0.002 rad for a
turn, 1 mm for a move -- so the curve the page plays is the same to the eye, at a fraction of the
bytes. Keys at the ends are always kept.

    python3 tools/avatars/thin_moves.py docs/city/models/moves/*.glb
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

ROT_TOL = 0.002     # rad
MOVE_TOL = 0.001    # m (in the rig's own units: a centimetre rig is scaled below)


def read_glb(path: Path):
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    jlen, _ = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, kind = struct.unpack_from("<II", data, off)
    assert kind == 0x004E4942
    return gltf, bytearray(data[off + 8: off + 8 + blen])


def accessor(gltf, binary, index):
    a = gltf["accessors"][index]
    view = gltf["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    assert a["componentType"] == 5126
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = view.get("byteStride", 4 * width)
    out = []
    for i in range(a["count"]):
        out.append(struct.unpack_from(f"<{width}f", binary, start + i * stride))
    return out


def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    if dot < 0:
        b, dot = tuple(-x for x in b), -dot
    if dot > 0.9995:
        q = tuple(x + (y - x) * t for x, y in zip(a, b, strict=True))
    else:
        th = math.acos(min(1.0, dot))
        s = math.sin(th)
        q = tuple((math.sin((1 - t) * th) * x + math.sin(t * th) * y) / s for x, y in zip(a, b, strict=True))
    n = math.sqrt(sum(x * x for x in q)) or 1
    return tuple(x / n for x in q)


def angle(a, b):
    dot = abs(sum(x * y for x, y in zip(a, b, strict=True)))
    return 2 * math.acos(min(1.0, dot))


def thin(times, values, kind, tol):
    """Indices of the keys kept: greedy, each run extended while every key it skips lies within tol."""
    n = len(times)
    if n <= 2:
        return list(range(n))
    keep, a = [0], 0
    while a < n - 1:
        b = a + 1
        while b + 1 < n:
            c = b + 1
            ok = True
            for k in range(a + 1, c):
                t = (times[k] - times[a]) / ((times[c] - times[a]) or 1)
                if kind == "rotation":
                    err = angle(slerp(values[a], values[c], t), values[k])
                else:
                    err = math.dist(tuple(x + (y - x) * t for x, y in zip(values[a], values[c], strict=True)), values[k])
                if err > tol:
                    ok = False
                    break
            if not ok:
                break
            b = c
        keep.append(b)
        a = b
    return keep


def rebuild(path: Path, out: Path | None = None) -> tuple[int, int]:
    gltf, binary = read_glb(path)
    before = path.stat().st_size
    # How big a metre is in the rig's units: the Soldier's skeleton is in centimetres.
    scale = 1.0
    for node in gltf["nodes"]:
        if node.get("scale") and abs(node["scale"][0] - 0.01) < 1e-4:
            scale = 100.0
    chunks, views, accessors = [], [], []

    def add(floats, width, kind_type, minmax=False):
        raw = struct.pack(f"<{len(floats) * width}f", *[x for v in floats for x in v])
        offset = sum(len(c) for c in chunks)
        pad = (-offset) % 4
        if pad:
            chunks.append(b"\0" * pad)
            offset += pad
        chunks.append(raw)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw)})
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(floats), "type": kind_type}
        if minmax:
            acc["min"] = [min(v[i] for v in floats) for i in range(width)]
            acc["max"] = [max(v[i] for v in floats) for i in range(width)]
        accessors.append(acc)
        return len(accessors) - 1

    # Everything not animation (the skeleton, the one triangle, its skin) copied over as it was.
    used_by_anim = {s[k] for a in gltf["animations"] for s in a["samplers"] for k in ("input", "output")}
    remap = {}
    for i, a in enumerate(gltf["accessors"]):
        if i in used_by_anim:
            continue
        view = gltf["bufferViews"][a["bufferView"]]
        raw = bytes(binary[view.get("byteOffset", 0): view.get("byteOffset", 0) + view["byteLength"]])
        offset = sum(len(c) for c in chunks)
        pad = (-offset) % 4
        if pad:
            chunks.append(b"\0" * pad)
            offset += pad
        chunks.append(raw)
        v = {k: view[k] for k in view if k not in ("byteOffset", "buffer")}
        views.append({"buffer": 0, "byteOffset": offset, **v})
        accessors.append({**a, "bufferView": len(views) - 1})
        remap[i] = len(accessors) - 1
    for key in ("meshes",):
        for mesh in gltf.get(key, []):
            for prim in mesh["primitives"]:
                prim["attributes"] = {k: remap[v] for k, v in prim["attributes"].items()}
                if "indices" in prim:
                    prim["indices"] = remap[prim["indices"]]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = remap[skin["inverseBindMatrices"]]
    time_cache, stats = {}, [0, 0]
    # A bone's move or size that never leaves its rest (every bone but the hips, in every clip) is
    # not kept as a channel at all: nothing else plays it, so the bone stays at rest either way, and
    # each channel costs its sampler and accessors in the file's JSON.
    def at_rest(ch, values):
        node = gltf["nodes"][ch["target"]["node"]]
        kind = ch["target"]["path"]
        if kind == "rotation":
            return False
        rest = node.get(kind) or ([0, 0, 0] if kind == "translation" else [1, 1, 1])
        tol = MOVE_TOL * (scale if kind == "translation" else 1)
        return all(math.dist(v, rest) <= tol for v in values)
    for anim in gltf["animations"]:
        drop = set()
        for i, ch in enumerate(anim["channels"]):
            sampler = anim["samplers"][ch["sampler"]]
            if at_rest(ch, accessor(gltf, binary, sampler["output"])):
                drop.add(i)
        if drop:
            kept = [ch for i, ch in enumerate(anim["channels"]) if i not in drop]
            used = sorted({ch["sampler"] for ch in kept})
            renum = {old: new for new, old in enumerate(used)}
            anim["samplers"] = [anim["samplers"][k] for k in used]
            for ch in kept:
                ch["sampler"] = renum[ch["sampler"]]
            anim["channels"] = kept
        for ch in anim["channels"]:
            sampler = anim["samplers"][ch["sampler"]]
            if "_done" in sampler:
                continue
            times = [t[0] for t in accessor(gltf, binary, sampler["input"])]
            values = accessor(gltf, binary, sampler["output"])
            path_kind = ch["target"]["path"]
            sampler_count = len(values)
            if sampler.get("interpolation", "LINEAR") == "LINEAR" and path_kind in ("rotation", "translation", "scale"):
                tol = ROT_TOL if path_kind == "rotation" else MOVE_TOL * (scale if path_kind == "translation" else 1)
                idx = thin(times, values, path_kind, tol)
                times = [times[i] for i in idx]
                values = [values[i] for i in idx]
            # (Time lists are shared between channels whose keys fell at the same times.)
            tkey = tuple(round(t, 6) for t in times)
            if tkey not in time_cache:
                time_cache[tkey] = add([(t,) for t in times], 1, "SCALAR", minmax=True)
            sampler["input"] = time_cache[tkey]
            stats[0] += len(values)
            stats[1] += sampler_count
            sampler["output"] = add(values, len(values[0]), {3: "VEC3", 4: "VEC4"}[len(values[0])])
            sampler["_done"] = True
        for sampler in anim["samplers"]:
            sampler.pop("_done", None)
    body = b"".join(chunks)
    body += b"\0" * ((-len(body)) % 4)
    gltf["bufferViews"], gltf["accessors"] = views, accessors
    gltf["buffers"] = [{"byteLength": len(body)}]
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(body)
    blob = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(body), 0x004E4942) + body
    (out or path).write_bytes(blob)
    print(f"  keys kept {stats[0]} of {stats[1]}, {len(time_cache)} time lists")
    return before, len(blob)


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        b, a = rebuild(Path(arg))
        print(f"{arg}: {b} -> {a} bytes")
