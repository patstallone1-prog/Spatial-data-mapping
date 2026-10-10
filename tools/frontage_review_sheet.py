"""Private contact sheets for real evidence inspection, not published textures."""

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def main():
    folder = ROOT / "build/frontage-live/review"
    output = ROOT / "build/frontage-accuracy-audit"
    output.mkdir(parents=True, exist_ok=True)
    selected = {}
    for path in folder.glob("*.json"):
        row = json.loads(path.read_text())
        if (
            not isinstance(row, dict)
            or row.get("status") != "screened_candidate_needs_privacy_and_identity_review"
        ):
            continue
        if not path.with_suffix(".context.jpg").exists():
            continue
        key = (row["region"], row["building_id"])
        if key not in selected or row["candidate"]["rank"] > selected[key][1]["candidate"]["rank"]:
            selected[key] = path, row
    items = sorted(selected.values(), key=lambda item: item[1]["candidate"]["rank"], reverse=True)
    index = []
    for batch in range(0, len(items), 16):
        canvas = np.full((1280, 1600, 3), 240, np.uint8)
        for k, (path, row) in enumerate(items[batch : batch + 16]):
            image = cv2.imread(str(path.with_suffix(".context.jpg")))
            scale = min(400 / image.shape[1], 265 / image.shape[0])
            image = cv2.resize(image, None, fx=scale, fy=scale)
            y, x = (k // 4) * 320, (k % 4) * 400
            canvas[y : y + image.shape[0], x : x + image.shape[1]] = image
            address = (row.get("address") or {}).get("formatted") or row["building_id"]
            cv2.putText(
                canvas,
                f"{batch + k}: {address[:42]}",
                (x + 4, y + 286),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                (0, 0, 0),
                1,
            )
            cv2.putText(
                canvas,
                f"{row['building_id']} {row['candidate']['angle_deg']} deg",
                (x + 4, y + 305),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (0, 0, 0),
                1,
            )
            index.append({"index": batch + k, "path": str(path), "address": address})
        cv2.imwrite(str(output / f"sheet-{batch // 16}.jpg"), canvas)
    (output / "index.json").write_text(json.dumps(index, indent=2))
    print({"houses": len(items), "output": str(output)})


if __name__ == "__main__":
    main()
