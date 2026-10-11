"""Accept or reject a fitted front automatically, and say why.

The fits used to wait for a person to tick fifteen boxes per house -- privacy, rights, stairs,
trim, metric alignment -- and none was ever ticked, so nothing a photograph showed reached the
model. Privacy is handled upstream (people are removed and number plates blurred before a photo
is fitted, and windows draw as plain glass, never what a photograph caught behind them), and
everything published is parameters: colours, opening sizes, entry types. No pixel is.

So a fit is accepted when the evidence in it holds together, checked here without a person:

  the source       a provider whose imagery may be used (never a restricted Google set)
  the view         the strict frontage gate passed: a front-on view, the whole front in frame
  the binding      the fitted front lies on the building's own front edge, geometry unmodified
  the content      something was read from it: a wall colour, and at least one window
  coherence        no conflicts (a threshold against a measured ground, a storey count that
                   contradicts the windows), openings inside the wall

and rejected otherwise, with the reasons. Accepted fits carry ``auto_accepted_visual_parameters``
and draw in the model; a fit a person reviewed keeps its own status.
"""

from __future__ import annotations

from smc.imagery.frontage_sources import RESTRICTED_DATASETS, source_block_reason

SCHEMA = "kerbside.auto_review/1"
STATUS = "auto_accepted_visual_parameters"
REVIEWER = "automatic:auto_review/1"


def _provider(fit: dict) -> str:
    locator = str(fit.get("source_locator") or "")
    return locator.split("://", 1)[0] if "://" in locator else ""


def decide(fit: dict) -> dict:
    """Accept or reject one fitted front; never edits the fit."""
    reasons, passes = [], []
    provider = _provider(fit)
    if not provider:
        reasons.append("source_unknown")
    elif source_block_reason(provider) or any(name in str(fit.get("source_locator")) for name in RESTRICTED_DATASETS):
        reasons.append("source_restricted")
    else:
        passes.append(f"source:{provider}")
    gate = fit.get("strict_frontage") or {}
    if not gate.get("metadata_pass"):
        reasons.append("frontage_view_gate_failed")
    else:
        passes.append("frontage_view_gate")
    evidence = fit.get("selection_evidence") or {}
    if evidence.get("full_front_in_frame") is False:
        reasons.append("front_not_fully_in_frame")
    binding = fit.get("front_geometry_binding") or {}
    if binding.get("status") != "bound":
        reasons.append("front_not_bound_to_building_edge")
    else:
        passes.append("bound_to_front_edge")
    if fit.get("canonical_geometry_modified"):
        reasons.append("canonical_geometry_modified")
    if fit.get("conflicts"):
        reasons.extend(f"conflict:{c}" for c in fit["conflicts"])
    openings = fit.get("openings") or []
    windows = [o for o in openings if o.get("kind") == "window"]
    colour = (fit.get("appearance") or {}).get("colour")
    if not colour:
        reasons.append("no_wall_colour_read")
    if not windows:
        reasons.append("no_window_read")
    width, height = fit.get("width_m"), fit.get("height_m")
    if isinstance(width, (int, float)) and isinstance(height, (int, float)):
        def inside(o):
            u, v = o.get("u", -1), o.get("v", -1)
            return (u >= -0.05 and u + o.get("w", 0) <= width + 0.05
                    and v >= -0.05 and v + o.get("h", 0) <= height + 0.05)
        outside = [o.get("id") for o in openings if not inside(o)]
        if outside:
            reasons.append("openings_outside_wall")
    else:
        reasons.append("wall_size_missing")
    if not reasons:
        passes += ["wall_colour", f"windows:{len(windows)}"]
        entry = fit.get("primary_entry")
        if entry:
            passes.append(f"entry:{entry.get('kind')}{'+gate' if entry.get('gate') else ''}")
    return {"schema": SCHEMA, "accept": not reasons, "reasons": reasons, "passes": passes,
            "reviewer": REVIEWER}


def accepted(fit: dict, decision: dict) -> dict:
    """The fit as published: the decision recorded, the status the renderer draws."""
    return {**fit, "review_status": STATUS, "auto_review": decision}
