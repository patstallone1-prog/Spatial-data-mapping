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
        design = o.get("design") or {}
        arched_entry = design.get("head") == "arched" and design.get("panel_style") != "sectional_grid" \
            and not (o.get("opening_reasoning") or {}).get("pixel_cues", {}).get("panel_grid")
        if arched_entry and o["v"] - base <= GARAGE_SILL_MAX_M and o["w"] <= 3.0:
            # An arched opening at the pavement with no garage door's panels in it is an entry: a
            # porch's arch, double doors under it -- as wide as a garage, but not one.
            o.update(role="entrance", role_certainty="medium", role_basis=["arched_head_without_garage_panels"])
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



#: Windows whose centres are this close in height are on one floor.
ROW_TOLERANCE_M = 0.5
#: A plain window this close in width to its floor's matching windows is one of them.
ROW_SAME_WIDTH = 0.35
#: Two windows this close in both dimensions, stacked or side by side, are one design.
NEIGHBOUR_SAME = 0.35
#: Stacked: centres this close across; side by side: this little wall between them.
STACK_ACROSS_M = 0.35
SIDE_GAP_M = 0.4
#: A window with no lines read and nothing to copy is divided into panes about this wide.
DEFAULT_PANE_WIDTH_M = 0.8
#: A pane this much taller than wide is a sash window: a meeting rail across its middle.
SASH_RATIO = 1.3


def _pattern(o: dict) -> tuple:
    d = o.get("design") or {}
    return (len(d.get("vertical_bars") or []), len(d.get("horizontal_bars") or []), d.get("shape") == "arched")


def _read(o: dict) -> bool:
    """A window whose own panes were read off the photograph."""
    return (_detail(o) > 0 and not o.get("size_inferred")
            and (o.get("design") or {}).get("panes_basis") is None)


def _take(o: dict, model: dict, w: float, h: float, v: float | None, key: str, source) -> None:
    """``o`` takes ``model``'s design and the given size, about its own centre."""
    design = dict(o.get("design") or {})
    for k in DETAIL_KEYS:
        if k in (model.get("design") or {}):
            design[k] = model["design"][k]
    design["panes_basis"] = key
    o["design"] = design
    cu, cv = o["u"] + o["w"] / 2, o["v"] + o["h"] / 2
    o.update(u=round(cu - w / 2, 3), v=round((cv - h / 2) if v is None else v, 3), w=round(w, 3), h=round(h, 3))
    o["size_from"] = source


def mirror_floors(found: list[dict]) -> int:
    """On a floor of three or more windows where two or more show the same panes, a plain one of
    about their width is one of them too: their panes and their size."""
    windows = sorted((o for o in found if o.get("role", o["kind"]) == "window"), key=lambda o: o["v"] + o["h"] / 2)
    rows: list[list[dict]] = []
    for o in windows:
        centre = o["v"] + o["h"] / 2
        if rows and abs(centre - (rows[-1][0]["v"] + rows[-1][0]["h"] / 2)) <= ROW_TOLERANCE_M:
            rows[-1].append(o)
        else:
            rows.append([o])
    mirrored = 0
    for row in rows:
        if len(row) < 3:
            continue
        read = [o for o in row if _read(o)]
        counts: dict[tuple, list[dict]] = {}
        for o in read:
            counts.setdefault(_pattern(o), []).append(o)
        models = max(counts.values(), key=len, default=[])
        if len(models) < 2:
            continue
        widths = sorted(o["w"] for o in models)
        if widths[-1] > widths[0] * (1 + NEIGHBOUR_SAME):
            continue
        mw = widths[len(widths) // 2]
        mh = sorted(o["h"] for o in models)[len(models) // 2]
        mv = sorted(o["v"] for o in models)[len(models) // 2]
        best = max(models, key=lambda o: o.get("confidence", 0))
        for o in row:
            if _detail(o) == 0 and _similar(o["w"], mw, ROW_SAME_WIDTH):
                _take(o, best, mw, mh, mv, "mirrored_from_its_floor", [m["id"] for m in models])
                mirrored += 1
    return mirrored


def _certainty(o: dict) -> float:
    return (o.get("confidence", 0) + 0.1 * _detail(o) + (0.0 if o.get("size_inferred") else 0.2)
            - (0.15 if (o.get("design") or {}).get("panes_basis") else 0.0))


def duplicate_neighbours(found: list[dict]) -> int:
    """Two windows one above the other, or side by side, of about one size -- a bay's windows on
    two storeys, the faces of a wrap-around window -- are one design: the surer of the two is
    drawn in both places (its panes and its size, each about its own centre)."""
    windows = sorted((o for o in found if o.get("role", o["kind"]) == "window"), key=_certainty, reverse=True)
    copied: set[str] = set()
    count = 0
    for hi in windows:
        if hi["id"] in copied:
            continue
        for lo in windows:
            if lo is hi or lo["id"] in copied or _certainty(lo) >= _certainty(hi):
                continue
            if not (_similar(lo["w"], hi["w"], NEIGHBOUR_SAME) and _similar(lo["h"], hi["h"], NEIGHBOUR_SAME)):
                continue
            stacked = (abs((lo["u"] + lo["w"] / 2) - (hi["u"] + hi["w"] / 2)) <= STACK_ACROSS_M
                       and abs((lo["v"] + lo["h"] / 2) - (hi["v"] + hi["h"] / 2)) >= max(lo["h"], hi["h"]))
            gap = max(lo["u"], hi["u"]) - min(lo["u"] + lo["w"], hi["u"] + hi["w"])
            beside = abs((lo["v"] + lo["h"] / 2) - (hi["v"] + hi["h"] / 2)) <= ROW_TOLERANCE_M and gap <= SIDE_GAP_M
            if not (stacked or beside):
                continue
            _take(lo, hi, hi["w"], hi["h"], None, "duplicate_of_a_surer_neighbour", hi["id"])
            copied.add(lo["id"])
            count += 1
    return count


def default_panes(found: list[dict]) -> int:
    """A window with no lines read and none to copy is divided into panes of the default width,
    with a meeting rail where the panes are tall -- marked as the default it is."""
    count = 0
    for o in found:
        if o.get("role", o["kind"]) != "window" or _detail(o) > 0:
            continue
        n = max(1, round(o["w"] / DEFAULT_PANE_WIDTH_M))
        vertical = [round(i / n, 3) for i in range(1, n)]
        horizontal = [0.5] if o["h"] / (o["w"] / n) >= SASH_RATIO else []
        if not vertical and not horizontal:
            continue
        o["design"] = {**(o.get("design") or {}), "vertical_bars": vertical, "horizontal_bars": horizontal,
                       "panes_basis": "default_pane_width", "default_pane_width_m": DEFAULT_PANE_WIDTH_M}
        count += 1
    return count


#: Window centres this close across are in one column.
COLUMN_TOLERANCE_M = 0.45
#: Columns two floors must share before one floor's grid stands for the other's.
COLUMN_MATCHES_MIN = 2
#: A spot whose pixels are this much plainly-seen bare wall is a blank wall, not a hidden window.
BLANK_WALL_SHARE = 0.8


def _rows(windows: list[dict]) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for o in sorted(windows, key=lambda o: o["v"] + o["h"] / 2):
        centre = o["v"] + o["h"] / 2
        if rows and abs(centre - sum(r["v"] + r["h"] / 2 for r in rows[-1]) / len(rows[-1])) <= ROW_TOLERANCE_M:
            rows[-1].append(o)
        else:
            rows.append([o])
    return rows


def _centre(o: dict) -> float:
    return o["u"] + o["w"] / 2


def _overlaps(a: dict, b: dict, margin: float = 0.15) -> bool:
    return (a["u"] - margin < b["u"] + b["w"] and b["u"] - margin < a["u"] + a["w"]
            and a["v"] - margin < b["v"] + b["h"] and b["v"] - margin < a["v"] + a["h"])


def complete_columns(found: list[dict], width: float, height: float, blank_wall=None) -> list[dict]:
    """A window the photograph did not show, where the front's own grid says one is.

    Floors of a front line their windows up in columns. Where one floor's windows all stand in
    columns another floor also has -- at least two of them, so the grid is the front's and not a
    coincidence -- a column the other floor has and this one lacks holds a window here too: the
    second floor's three over the first floor's middle and right put one on the first floor's
    left. It is drawn at this floor's own window size and height, never over a door, a garage or
    an entry, and never where the photograph plainly shows bare wall (``blank_wall(box)`` gives
    the share of the spot seen as wall; a tree, a car or the frame's edge in front of it is not
    bare wall). Marked as the inference it is.
    """
    windows = [o for o in found if o.get("role", o["kind"]) == "window"]
    others = [o for o in found if o.get("role", o["kind"]) != "window"]
    rows = _rows(windows)
    added: list[dict] = []
    for row in rows:
        for other in rows:
            if other is row or len(other) <= len(row):
                continue
            matched = {id(o): min(other, key=lambda m: abs(_centre(m) - _centre(o))) for o in row}
            if any(abs(_centre(m) - _centre(o)) > COLUMN_TOLERANCE_M
                   for o in row for m in [matched[id(o)]]):
                continue
            used = {id(m) for m in matched.values()}
            if len(used) < min(COLUMN_MATCHES_MIN, len(row)) or len(used) < COLUMN_MATCHES_MIN:
                continue
            w = sorted(o["w"] for o in row)[len(row) // 2]
            h = sorted(o["h"] for o in row)[len(row) // 2]
            v = sorted(o["v"] for o in row)[len(row) // 2]
            model = max(row, key=lambda o: (_detail(o), o.get("confidence", 0)))
            for column in (m for m in other if id(m) not in used):
                u = _centre(column) - w / 2
                box = {"u": round(u, 3), "v": round(v, 3), "w": round(w, 3), "h": round(h, 3)}
                if u < 0.05 or u + w > width - 0.05 or v + h > height - 0.15:
                    continue
                if any(_overlaps(box, o) for o in others + windows + added):
                    continue
                seen_bare = blank_wall(box) if blank_wall else 0.0
                if seen_bare >= BLANK_WALL_SHARE:
                    continue
                added.append({
                    "id": f"column-{len(added)}", "kind": "window", **box,
                    "confidence": 0.25,
                    "design": {k: v2 for k, v2 in (model.get("design") or {}).items() if k in DETAIL_KEYS},
                    "grade": "inferred_from_column_symmetry_not_seen",
                    "position_sigma_m": 0.4,
                    "size_anomaly_requires_review": False, "type_requires_review": False,
                    "role": "window", "role_certainty": "low",
                    "role_basis": ["column_symmetry", f"column_of:{column['id']}",
                                   f"floor_columns_matched:{len(used)}",
                                   f"bare_wall_seen_share:{round(float(seen_bare), 2)}"],
                    "size_inferred": True, "size_from": model["id"],
                })
    return added
