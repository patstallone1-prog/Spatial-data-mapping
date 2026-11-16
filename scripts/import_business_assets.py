"""Acquire reviewed CC0 business props, then normalize and validate lightweight GLBs.

python scripts/import_business_assets.py --cache /path/to/cache
Install tools/business-assets/package.json dependencies there, or set KERBSIDE_ASSET_NODE_MODULES.
No accounts, paid assets, production publishing or remote model runtime dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
REVISION = "153c8a7535b48237854cb54ff6890679f8c574d1"
KAY = f"https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0/{REVISION}/"
MEDICAL = {
    "hospital-bed": ("hospital_bed", 2.2),
    "examination-table": ("examination_table", 1.9),
    "dentist-chair": ("dentist_chair", 2.0),
    "medical-cart": ("medical_cart", 1.0),
    "medicine-cabinet": ("medicine_cabinet", 1.8),
    "patient-monitor": ("patient_monitor", 1.4),
    "iv-stand": ("iv_stand", 1.9),
    "privacy-screen": ("privacy_screen", 1.8),
    "doctor-scale": ("doctor_scale", 1.6),
    "wheelchair": ("wheelchair", 1.1),
    "ultrasound-machine": ("ultrasound_machine", 1.4),
    "defibrillator": ("medical_item", 0.45),
}


def fetch(url, path, referer=None):
    path = Path(path)
    if not path.exists() or not path.stat().st_size:
        data = urlopen(
            Request(
                url,
                headers={"User-Agent": "Mozilla/5.0", **({"Referer": referer} if referer else {})},
            ),
            timeout=45,
        ).read()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".partial")
        temp.write_bytes(data)
        temp.replace(path)
    data = path.read_bytes()
    return {"url": url, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def kay_role(name):
    if name.startswith(("wall", "floor", "door", "pillar", "towelrail", "shelf_papertowel")):
        return None
    if name.startswith("chair"):
        return ("bar_stool", 0.85) if "stool" in name else ("dining_chair", 0.95)
    if name.startswith("table_round") and "decorated" in name:
        return "dining_set", 1.4
    if name.startswith("kitchentable") and "decorated" in name:
        return "prep_station", 1.8
    if name.startswith("table_round"):
        return "dining_table", 1.0 if "small" in name else 1.4
    if name.startswith("kitchentable"):
        return ("warewash_sink", 1.8) if "sink" in name else ("prep_table", 1.8)
    if name.startswith("kitchencounter"):
        return ("sink_counter", 1.2) if "sink" in name else ("counter", 1.2)
    if name.startswith("kitchencabinet"):
        return "storage_cabinet", 1.6
    if name.startswith("fridge"):
        return "commercial_fridge", 1.9
    if name.startswith(("oven", "stove")):
        return ("counter_item", 0.4) if "countertop" in name else ("commercial_range", 1.0)
    if name.startswith("crate"):
        return "stock_crate", 0.6
    if name == "extractorhood":
        return None  # Mounted ductwork needs its separate support/clearance contract.
    return ("cutting_board", 0.4) if name == "cuttingboard" else ("table_item", 0.22)


def acquire(cache):
    tree_path = cache / "kay-tree.json"
    fetch(
        f"https://api.github.com/repos/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0/git/trees/{REVISION}?recursive=1",
        tree_path,
    )
    tree = json.loads(tree_path.read_text())["tree"]
    license_path = cache / "kay/LICENSE.txt"
    fetch(KAY + "LICENSE.txt", license_path)
    if (
        "CC0" not in license_path.read_text()
        and "Creative Commons Zero" not in license_path.read_text()
    ):
        raise ValueError("KayKit license did not match the reviewed CC0 source")
    jobs = []

    def kay(row):
        name = Path(row["path"]).stem
        choice = kay_role(name)
        if not choice:
            return None
        url = KAY + row["path"]
        target = cache / "kay" / row["path"]
        evidence = [fetch(url, target)]
        gltf = json.loads(target.read_text())
        for item in [*gltf.get("buffers", []), *gltf.get("images", [])]:
            uri = item.get("uri", "")
            if not uri or uri.startswith("data:"):
                continue
            dest = (target.parent / uri).resolve()
            if cache.resolve() not in dest.parents:
                raise ValueError("Asset dependency escaped the cache")
            evidence.append(fetch(urljoin(url, uri), dest))
        return dict(
            id="kay-" + name.lower(),
            name=name.replace("_", " "),
            role=choice[0],
            longest_m=choice[1],
            input=str(target),
            download=url,
            source="https://kaylousberg.itch.io/restaurant-bits",
            author="Kay Lousberg / KayKit",
            source_files=evidence,
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        for job in pool.map(
            kay, [r for r in tree if "/gltf/" in r["path"] and r["path"].endswith(".gltf")]
        ):
            if job:
                jobs.append(job)

    kit_path = cache / "grab-medical-kit.html"
    fetch("https://grab3d.com/kits/cozy-hospital-medical/", kit_path)
    kit = kit_path.read_text()
    for slug, (role, longest) in MEDICAL.items():
        match = re.search(r'href=["\']([^"\']*/models/[^"\']*/' + re.escape(slug) + r'/)["\']', kit)
        if not match:
            raise ValueError(f"Medical asset missing from source kit: {slug}")
        source = urljoin("https://grab3d.com", match[1])
        page_path = cache / f"medical/{slug}.html"
        fetch(source, page_path)
        page = page_path.read_text()
        if "CC0" not in page:
            raise ValueError(f"Missing CC0 evidence: {source}")
        urls = re.findall(r'https://grab3d.com/dl/[^"\s<>]+\.glb', page)
        urls = list(dict.fromkeys(urls))
        url = next((u for u in urls if "-light.glb" in u), next(iter(urls), None))
        if not url:
            raise ValueError(f"No direct GLB download: {source}")
        target = cache / f"medical/{slug}.glb"
        evidence = fetch(url, target)
        jobs.append(
            dict(
                id="medical-" + slug,
                name=slug.replace("-", " "),
                role=role,
                longest_m=longest,
                input=str(target),
                source=source,
                download=url,
                author="Grab3D",
                source_files=[evidence],
            )
        )
    jobs.extend(kenney_furniture(cache))
    for job in jobs:
        job["license"] = "CC0-1.0"
    return jobs


def kenney_furniture(cache):
    source = "https://kenney.nl/assets/furniture-kit"
    page_path = cache / "kenney/publisher.html"
    fetch(source, page_path)
    page = page_path.read_text()
    if "creativecommons.org/publicdomain/zero" not in page:
        raise ValueError("Kenney CC0 declaration missing")
    token = re.search(r"data-download-id=[\"']([a-f0-9]+)", page)[1]
    receipt_path = cache / "kenney/download.json"
    fetch("https://kenney.nl/download-link/" + token, receipt_path, source)
    url = json.loads(receipt_path.read_text())["url"]
    archive = cache / "kenney/furniture.zip"
    evidence = fetch(url, archive, source)
    jobs = []
    with zipfile.ZipFile(archive) as z:
        license_text = z.read("License.txt").decode()
        if "CC0" not in license_text:
            raise ValueError("Bundled Kenney license missing")
        (cache / "kenney/License.txt").write_text(license_text)
        for member in z.namelist():
            if not member.startswith("Models/GLTF format/") or not member.endswith(".glb"):
                continue
            name = Path(member).stem
            role = None
            longest = 1.4
            if name.startswith("chair"):
                role = "office_chair" if "Desk" in name else "dining_chair"
                longest = 1.0
            elif name in ["loungeDesignSofa", "loungeSofa", "loungeSofaLong"]:
                role = "booth"
                longest = 1.8
            elif name.startswith("lounge") and "Chair" in name:
                role = "armchair"
                longest = 0.95
            elif name.startswith("tableCoffee"):
                role = "coffee_table"
                longest = 1.1
            elif name.startswith("table"):
                role = "dining_table"
                longest = 1.4
            elif name.startswith("desk"):
                role = "desk"
                longest = 1.4
            elif name.startswith("bookcase"):
                role = "bookshelf"
                longest = 1.8
            elif name in ["cardboardBoxClosed", "cardboardBoxOpen"]:
                role = "stock_crate"
                longest = 0.5
            elif name in ["washer", "washerDryerStacked"]:
                role = "commercial_washer" if name == "washer" else "commercial_dryer"
                longest = 1.1 if name == "washer" else 1.9
            elif name.startswith("bench"):
                role = "waiting_bench"
                longest = 1.6
            elif name in ["kitchenBar", "kitchenBarEnd"]:
                role = "service_counter"
                longest = 1.5
            elif name == "trashcan":
                role = "waste_bin"
                longest = 0.65
            if not role:
                continue
            target = cache / "kenney/models" / Path(member).name
            target.parent.mkdir(parents=True, exist_ok=True)
            data = z.read(member)
            target.write_bytes(data)
            jobs.append(
                dict(
                    id="kenney-" + name.lower(),
                    name=re.sub(r"([a-z])([A-Z])", r"\1 \2", name),
                    role=role,
                    longest_m=longest,
                    input=str(target),
                    source=source,
                    download=url,
                    author="Kenney",
                    source_files=[
                        evidence,
                        dict(
                            member=member, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)
                        ),
                    ],
                )
            )
    return jobs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    jobs = acquire(args.cache)
    path = args.cache / "jobs.json"
    path.write_text(json.dumps(jobs, indent=2) + "\n")
    print(f"Acquired {len(jobs)} models", flush=True)
    result = subprocess.run(
        [
            "node",
            str(ROOT / "tools/business-assets/prepare.mjs"),
            str(path),
            str(ROOT / "docs/interior-assets"),
        ],
        check=False,
    )
    prepared = json.loads(Path(str(path) + ".results.json").read_text())
    if result.returncode or prepared["failures"]:
        raise SystemExit(
            "Some models failed validation; manifest left unchanged. See the preparation report."
        )
    manifest = ROOT / "docs/interior-assets/manifest.json"
    data = json.loads(manifest.read_text())
    added = {r["id"]: r for r in prepared["assets"]}
    data["assets"] = [r for r in data["assets"] if r["id"] not in added] + list(added.values())
    data["business_lowpoly_import"] = dict(
        count=len(added),
        source_revision=REVISION,
        license="CC0-1.0",
        max_triangles=8500,
        max_texture_px=512,
    )
    manifest.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Registered {len(added)} validated models", flush=True)


if __name__ == "__main__":
    main()
