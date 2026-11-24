"""Pick a small, complementary shot list per face from the assessed frames.

A face needs different things from different photos: one square-on elevation for proportions
and materials, a sharp recent frontal for sign text, and an oblique from each side for depth
(awnings, blade signs, bays, cornice projection). Picking the top five by one score would
return five frames from the same drive-by; the slots below plus a same-sequence penalty
spread the list across viewpoints, sequences and dates.
"""

from __future__ import annotations

SLOTS = (
    ("sign", "signage", lambda a: a["view"] == "frontal" or a["metrics"]["incidence_deg"] < 35),
    ("elevation", "architecture", lambda a: a["view"] == "frontal"),
    ("oblique-left", "architecture", lambda a: a["view"] == "oblique-left"),
    ("oblique-right", "architecture", lambda a: a["view"] == "oblique-right"),
)


def select(assessments: list[dict], frames: dict[str, dict], k: int = 6,
           pixel_scores: dict[tuple[str, str], float] | None = None) -> list[dict]:
    """Assessments (``Assessment.to_json`` dicts, one face) -> ranked picks with a ``slot``."""
    ok = [a for a in assessments if a["ok"]]

    def score(a: dict, kind: str) -> float:
        s = a["scores"][kind]
        if pixel_scores is not None:
            s *= pixel_scores.get((a["frame_id"], a["face_id"]), 1.0)
        return s

    picks: list[dict] = []
    used: set[str] = set()
    seqs: dict[str, int] = {}

    def penalty(a: dict) -> float:
        seq = frames.get(a["frame_id"], {}).get("sequence")
        return 0.55 ** seqs.get(seq, 0) if seq else 1.0

    def take(a: dict, slot: str, kind: str) -> None:
        used.add(a["frame_id"])
        seq = frames.get(a["frame_id"], {}).get("sequence")
        if seq:
            seqs[seq] = seqs.get(seq, 0) + 1
        picks.append({**a, "slot": slot, "slot_score": round(score(a, kind) * penalty(a), 4)})

    for slot, kind, want in SLOTS:
        pool = [a for a in ok if a["frame_id"] not in used and want(a) and score(a, kind) > 0]
        if pool:
            best = max(pool, key=lambda a: score(a, kind) * penalty(a))
            take(best, slot, kind)
    while len(picks) < k:
        pool = [a for a in ok if a["frame_id"] not in used and score(a, "architecture") > 0]
        if not pool:
            break
        best = max(pool, key=lambda a: score(a, "architecture") * penalty(a))
        take(best, "extra", "architecture")
    return picks
