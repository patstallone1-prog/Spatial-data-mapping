import json, os, sys, urllib.request
from PIL import Image
src = "src"; out = "prepped"
for m in sorted(x for x in os.listdir(src) if os.path.isdir(f"{src}/{x}")):
    g = json.load(open(f"{src}/{m}/{m}.gltf")); files = json.load(open(f"{src}/{m}.files.json"))
    os.makedirs(f"{out}/{m}/textures", exist_ok=True)
    masked = any(x.get("alphaMode") == "MASK" for x in g["materials"])
    alpha = None
    if masked:
        url = files["Alpha"]["1k"]["jpg"]["url"]
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "kerbside"}), timeout=120).read()
        open(f"{src}/{m}/alpha.jpg", "wb").write(raw); alpha = Image.open(f"{src}/{m}/alpha.jpg").convert("L")
    new_images = []
    for i, im in enumerate(g["images"]):
        name = os.path.basename(im["uri"])
        img = Image.open(f"{src}/{m}/{im['uri']}")
        kind = "diff" if "_diff_" in name else "nor" if "_nor_" in name else "arm" if "_arm_" in name else "rough" if "_rough_" in name else "other"
        img = img.convert("RGB").resize((512, 512), Image.LANCZOS)
        if kind == "diff" and alpha is not None:
            img = img.convert("RGBA"); img.putalpha(alpha.resize((512, 512), Image.LANCZOS))
            path = f"textures/{m}_diff.png"; img.save(f"{out}/{m}/{path}", optimize=True)
        else:
            path = f"textures/{m}_{kind}.jpg"; img.save(f"{out}/{m}/{path}", quality=82)
        new_images.append({"uri": path, "name": f"{m}_{kind}"})
    g["images"] = new_images
    for b in g["buffers"]:
        os.link(f"{src}/{m}/{b['uri']}", f"{out}/{m}/{b['uri']}") if not os.path.exists(f"{out}/{m}/{b['uri']}") else None
    json.dump(g, open(f"{out}/{m}/{m}.gltf", "w"))
    print(m, "masked" if masked else "solid", [x["uri"] for x in new_images])
