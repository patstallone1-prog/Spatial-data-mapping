# Spatial Mapping Crowdsource

Standalone project. **Nothing here relates to `lexamentary` / dylumio** — do not read from,
write to, or reason about that repo while working in this one.

## What this is
A camera-only crowdsourced mapping network. Wearers' glasses supply a plain RGB feed; the
phone supplies GPS + motion. All geometric accuracy is manufactured in software from
overlapping ordinary camera views. The product is not imagery — it is a versioned table of
**world-facts** (geometry + semantics + confidence + provenance) served to a free consumer
map and a paid robot-navigation API.

## Founding document
`docs/camera-only-fusion-respec.md` — the technical re-spec (v: camera-only, gate-driven,
Aug 20 2026). It is the source of truth for scope, layer boundaries, and accuracy gates.
Deferred by explicit decision in that document: bystander privacy/biometric law, Meta
publisher access, SDK commercial terms.

## Layer boundaries (do not blur these)
- **A — Smart capture:** decide *when* to shoot. Build it. Small.
- **B — Compression/upload:** the phone's hardware encoder. **Do not build a codec.**
- **C — Fusion engine:** overlapping views → world-facts. This is the entire company.
- **D — Distribution:** consumer map + robot API. Standard software.

## Non-negotiable engine rules
- A fresh measurement that disagrees with the map or the building code **wins**, and the
  disagreement is flagged. Never smooth a real anomaly back to the ideal.
- Every served element carries confidence, measured-vs-inferred, freshness, corroboration count.
- Tier C (¼-inch steps, sub-1% slope) is **never** served as measured. Low-confidence
  "verify on-vehicle" flag only.
- Capture-agnostic: the engine's input contract is "a camera view, from somewhere, with a
  rough position." Real depth, if it ever arrives, is a higher-confidence observation into
  the same pipeline — upside, never a dependency.
