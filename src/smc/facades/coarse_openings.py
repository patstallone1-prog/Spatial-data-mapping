"""Every rectangle on a front becomes something: shape and height first, fine detail after.

The fit used to keep only what it could describe completely -- a window with its panes, a door
whose stairs were proven, a garage whose panels were seen -- and a house whose photograph showed
a two-storey bay, a garage the detector called a door, or a window too plain to read came out
as a blank wall. This pass is coarse to fine:

  basic shape     every detected rectangle is given a role from where it is and how big it is:
                  above the ground storey it is a window, whatever its panes; on the ground it is
                  a garage when it is a car's width, else an entrance -- and anything a fence,
                  a stair or an alcove stands at is an entrance whatever its size
  groups          a box the detector named a bay or a balcony (``canopy``, ``balcony``) spanning
                  a storey or more holds a window on each storey it spans
  fine detail     a window whose panes, arch or trim could not be read takes them from a window
                  of the same shape on the same front that could -- and a window whose size was
                  only inferred takes that window's measured proportions too

Nothing here is measured that was not measured before: roles and borrowed detail say where they
came from (``role_basis``, ``detail_from``, ``size_from``).
"""

from __future__ import annotations

SCHEMA = "kerbside.coarse_openings/1"
#: A storey, where the photograph's window rows gave none.
DEFAULT_STOREY_M = 3.1
#: Ground openings a car's width: a labelled garage door from here, any opening from GARAGE_ANY.
GARAGE_LABELLED_M = (1.7, 6.0)
GARAGE_ANY_MIN_M = 2.1
#: Or this wide and wider than tall (a person's door, even a double one, is taller than wide).
GARAGE_WIDE_MIN_M = 1.5
GARAGE_ASPECT = 0.9
GARAGE_HEIGHT_M = (1.4, 3.6)
#: How far above the facade foot a garage's sill may be read (a driveway's slope, a kerb).
GARAGE_SILL_MAX_M = 0.8
PEDESTRIAN_M = (0.55, 1.9)
#: Shapes this close (as a fraction of the larger) are the same window.
SAME_SHAPE = 0.15
#: A bay or balcony box this much of a storey tall or more holds windows.
GROUP_MIN_STOREYS = 0.6
SAME_WIDTH_FOR_INFERRED = 0.25
DETAIL_KEYS = ("vertical_bars", "horizontal_bars", "shape", "arch_spring_fraction", "trim")


def storey_height(storey: dict, height: float) -> float:
    for key in ("visual_storey_height_m", "storey_height_m"):
        value = storey.get(key)
        if isinstance(value, (int, float)) and 2.3 <= value <= 7:
            return float(value)
    return height / max(1, round(height / DEFAULT_STOREY_M))


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _covers(o: dict, box: dict, fraction: float = 0.3) -> bool:
    """Whether ``o`` already fills at least ``fraction`` of ``box`` (a small pane inside a big
    bay does not fill the bay)."""
    area = _overlap(o["u"], o["u"] + o["w"], box["u"], box["u"] + box["w"]) * _overlap(
        o["v"], o["v"] + o["h"], box["v"], box["v"] + box["h"])
    return area >= fraction * box["w"] * box["h"]


def _at_entry(o: dict, entries: list[dict]) -> dict | None:
    """The entry -- its door, its gate, its stair or alcove -- this opening stands at."""
    for e in entries:
        if e.get("kind") == "upper_door":
            continue
        if e.get("door_id") == o.get("id"):
            return e
        spans = [(e["u"], e["u"] + e["w"])]
        if e.get("gate"):
            spans.append((e["gate"]["u"], e["gate"]["u"] + e["gate"]["w"]))
        if e.get("recess_width_m"):
            mid = e["u"] + e["w"] / 2
            spans.append((mid - e["recess_width_m"] / 2, mid + e["recess_width_m"] / 2))
        if any(_overlap(o["u"], o["u"] + o["w"], s0, s1) >= 0.3 * o["w"] for s0, s1 in spans):
            return e
    return None


def assign_roles(found: list[dict], entries: dict, width: float, height: float, storey: dict) -> None:
    """Give every opening a role -- window, garage or entrance -- from its shape and height."""
    upper = storey_height(storey, height) * 0.8
    listed = entries.get("entries", [])
    garages: list[dict] = []
    # Sills are read from the lowest ground opening: a photograph's facade foot is often the
    # pavement a metre below the doors.
    ground = [o["v"] for o in found if o["kind"] != "window" and o["v"] < upper]
    base = min(ground) if ground else 0.0
    for o in found:
        kind, basis = o["kind"], []
        reasoning = o.get("opening_reasoning") or {}
        label = reasoning.get("original_label") or kind
        if kind == "window":
            o.update(role="window", role_certainty="high", role_basis=["detected_window"])
            continue
        if kind == "gated_entry_candidate":
            o.update(role="entrance", role_certainty="medium", role_basis=["gate_or_fence"])
            continue
        entry = _at_entry(o, listed)
        if o["v"] >= upper and not (entry and entry.get("kind") in {"long_stair", "short_stair"}):
            # A rectangle above the ground storey is a window: a balcony door is glass too.
            o.update(role="window", role_certainty="medium",
                     role_basis=["rectangle_above_ground_storey", f"detected_as:{label}"])
            continue
        if reasoning.get("class") == "garage_candidate" or kind == "garage_candidate":
            role, certainty = "garage", "high"
            basis.append("garage_scale_and_panels")
        elif entry is not None:
            role, certainty = "entrance", "high" if entry.get("kind") != "flush" else "medium"
            basis.append(f"at_entry:{entry.get('kind')}" + ("+gate" if entry.get("gate") else ""))
        elif (GARAGE_LABELLED_M[0] <= o["w"] <= GARAGE_LABELLED_M[1]
              and GARAGE_HEIGHT_M[0] <= o["h"] <= GARAGE_HEIGHT_M[1] and o["v"] - base <= GARAGE_SILL_MAX_M
              and (label == "garage door" or (o.get("design") or {}).get("panel_style")
                   in {"sectional_grid", "horizontal_sections"})):
            role, certainty = "garage", "medium"
            basis.append("labelled_garage_door_at_car_width")
        elif ((o["w"] >= GARAGE_ANY_MIN_M or (o["w"] >= GARAGE_WIDE_MIN_M and o["w"] / o["h"] >= GARAGE_ASPECT))
              and o["w"] <= GARAGE_LABELLED_M[1]
              and GARAGE_HEIGHT_M[0] <= o["h"] <= GARAGE_HEIGHT_M[1] and o["v"] - base <= GARAGE_SILL_MAX_M):
            # A car's width, or a ground opening wider than it is tall: a door for people is
            # taller than it is wide, even a double one.
            role, certainty = "garage", "medium"
            basis.append("ground_opening_at_car_width" if o["w"] >= GARAGE_ANY_MIN_M
                         else "ground_opening_wider_than_tall")
        elif PEDESTRIAN_M[0] <= o["w"] <= PEDESTRIAN_M[1]:
            role, certainty = "entrance", "medium"
            basis.append("ground_opening_at_door_width")
        else:
            role, certainty = "unresolved", "low"
            basis.append("too_wide_for_a_garage_or_too_narrow_for_a_door")
        o.update(role=role, role_certainty=certainty, role_basis=basis)
        if role == "garage":
            garages.append(o)
    # One garage per door: two readings of the same door are one, the surer kept.
    rank = {"high": 2, "medium": 1, "low": 0}
    garages.sort(key=lambda g: (rank[g["role_certainty"]], g.get("confidence", 0)), reverse=True)
    kept: list[dict] = []
    for g in garages:
        if any(_overlap(g["u"], g["u"] + g["w"], k["u"], k["u"] + k["w"]) >= 0.4 * min(g["w"], k["w"])
               for k in kept):
            g.update(role="unresolved", role_certainty="low",
                     role_basis=[*g["role_basis"], "duplicate_of_a_surer_garage"])
            continue
        kept.append(g)


def group_windows(found: list[dict], details: list[dict] | None, width: float, height: float,
                  storey: dict) -> list[dict]:
    """A window on each storey of every bay or balcony box no detected window already fills."""
    storey_m = storey_height(storey, height)
    upper = storey_m * 0.8
    windows = [o for o in found if o.get("role", o["kind"]) == "window"]
    added: list[dict] = []
    for item in details or []:
        if item.get("kind") not in {"canopy", "balcony"}:
            continue
        x0, y0, x1, y1 = item["box"]
        u, w = max(0.0, x0) * width, (min(1.0, x1) - max(0.0, x0)) * width
        v, h = (1 - min(1.0, y1)) * height, (min(1.0, y1) - max(0.0, y0)) * height
        # A box against the top of the front is the roof's: a gable, a cornice, a parapet. One
        # much shorter than a storey is an eave or an awning; a bay runs most of a storey.
        if y0 * height < 0.3 or h < GROUP_MIN_STOREYS * storey_m or w < 0.6 or w > 4.5 or v + h < upper:
            continue
        rows = max(1, round(h / storey_m))
        for i in range(rows):
            row_v, row_h = v + i * h / rows, h / rows
            wh = min(2.2, 0.62 * row_h)
            wv = row_v + (row_h - wh) * 0.55
            ww = min(w * 0.86, w - 0.2)
            wu = min(max(u + (w - ww) / 2, 0.08), width - 0.08 - ww)
            box = {"u": wu, "v": wv, "w": ww, "h": wh}
            if wv < upper or wv + wh > height - 0.3 or ww < 0.4:
                continue
            if any(_covers(o, box) for o in windows + added):
                continue
            added.append({
                "id": f"coarse-{len(added)}", "kind": "window",
                "u": round(wu, 3), "v": round(wv, 3), "w": round(ww, 3), "h": round(wh, 3),
                "confidence": float(item.get("score", 0.3)) * 0.6,
                "design": {"shape": "standard", "vertical_bars": [], "horizontal_bars": []},
                "grade": "inferred_from_detected_bay_or_balcony",
                "position_sigma_m": 0.5,
                "size_anomaly_requires_review": False, "type_requires_review": False,
                "role": "window", "role_certainty": "medium",
                "role_basis": [f"storey_{i + 1}_of_{rows}_in_detected:{item['kind']}"],
                "size_inferred": True,
            })
    return added


def _detail(o: dict) -> int:
    d = o.get("design") or {}
    return (len(d.get("vertical_bars") or []) + len(d.get("horizontal_bars") or [])
            + 2 * (d.get("shape") == "arched") + bool(d.get("trim")))


def _similar(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) <= tolerance * max(a, b)


def share_window_detail(found: list[dict]) -> int:
    """Windows of one shape share the detail the best-read of them shows. Returns how many took it."""
    windows = [o for o in found if o.get("role", o["kind"]) == "window"]
    donors = [o for o in windows if _detail(o) > 0 and not o.get("size_inferred")]
    shared = 0
    for o in windows:
        if _detail(o) > 0:
            continue
        inferred = bool(o.get("size_inferred"))
        matches = [d for d in donors if d is not o and _similar(o["w"], d["w"], SAME_WIDTH_FOR_INFERRED
                                                                 if inferred else SAME_SHAPE)
                   and (inferred or _similar(o["h"], d["h"], SAME_SHAPE))]
        if not matches:
            continue
        donor = min(matches, key=lambda d: (abs(d["w"] - o["w"]) + abs(d["h"] - o["h"]),
                                            abs(d["v"] - o["v"])))
        design = dict(o.get("design") or {})
        for key in DETAIL_KEYS:
            if key in (donor.get("design") or {}):
                design[key] = donor["design"][key]
        design["detail_from"] = donor["id"]
        o["design"] = design
        if inferred:
            # The inferred window takes the measured one's proportions, about its own centre.
            cu, cv = o["u"] + o["w"] / 2, o["v"] + o["h"] / 2
            o.update(u=round(cu - donor["w"] / 2, 3), v=round(cv - donor["h"] / 2, 3),
                     w=donor["w"], h=donor["h"], size_from=donor["id"])
        shared += 1
    return shared

