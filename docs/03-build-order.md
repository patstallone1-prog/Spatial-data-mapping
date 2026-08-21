# Build Order — Concept to Production

Compiled 2026-08-20. Target is production software, not a prototype: every stage ships with
tests, migrations, observability, and a defined failure mode.

---

## Principles

1. **Buy or import; build only Layer C fusion logic.** Every box below names its dependency.
   If a box has no dependency named, that is the IP.
2. **Gates are code, not milestones.** The ground-truth checker is service #1, not a later task.
   A tier bar that is not machine-evaluated on every pipeline run is not a bar.
3. **The Produced Work boundary is enforced in the schema**, not in a policy document. ODbL
   reference geometry lives in a separate database with no foreign keys into the facts store.
4. **No Google data path, ever.** Enforced by an allowlist in the ingest client and a CI check.

## The sequencing decision that shapes everything

**Build and validate the entire fusion engine before writing a line of capture app.**

Mapillary provides free, commercially-usable, street-level imagery with pose metadata across most
dense corridors. That means Layer C can be built, measured against municipal ground truth, and
pushed through the Tier A and Tier B gates **with zero contributors**. The cold-start problem
applies only to *freshness and coverage*, which is a growth problem — not to *engine correctness*,
which is the technical risk. Building the app first would sequence the easy problem ahead of the
hard one and stall on user acquisition before knowing whether the engine works.

---

## Stage 0 — Foundations (weeks 1–3)

| Deliverable | Detail | Dependency |
|---|---|---|
| Monorepo + CI | Typed Python for pipeline, TS for API/app. Ruff/mypy strict, pytest, GitHub Actions. Pinned model weights by hash. | — |
| **World-facts schema v1** | Bitemporal PostGIS. Every element: geometry, class, value, unit, `confidence`, `measured_vs_inferred`, `observed_at`, `corroboration_count`, `contributor_set_hash`, `source_run_id`. Aligned to the **OpenSidewalks schema** where classes overlap so municipal export is free. | PostGIS, OpenSidewalks |
| **Reference DB (separate instance)** | Overture buildings/transportation, OSM extracts. ODbL-tagged. No cross-DB FKs. A CI test fails the build if any facts-table migration references it. | Overture, OSM |
| **Ground-truth checker** | Service that samples served facts, joins to municipal inventories / Project Sidewalk labels / reference-walk measurements, and emits the per-tier error distribution and pass/fail. Runs on every pipeline release. | Project Sidewalk API, municipal open data |
| **Eval harness + frozen benchmark** | A held-out corridor set with tape/RTK truth. Versioned. Every model swap is scored against it. | — |
| Reference-walk kit | Laser distance meter, digital inclinometer, RTK GNSS rover (~5 cm). | Hardware, one-time |
| License gate in CI | Asserts no non-commercial weights (SuperPoint, SuperGlue, DA3-GIANT/LARGE, VGGT non-commercial ckpt) and no Google endpoint reachable from ingest. | — |

**Exit gate:** checker reports a real error distribution against a real corridor using
hand-entered facts. The measurement apparatus works before anything is measured.

## Stage 1 — Fusion engine on borrowed imagery (weeks 3–14)

Built as discrete, independently testable pipeline stages. No app, no contributors.

| Step | Build | Dependency |
|---|---|---|
| 1. Ingest | Mapillary harvester: sequences by bbox, pose metadata, quality filter. Idempotent, resumable, rate-limit aware (60k/min entity, 50k/day tiles). | Mapillary API v4 |
| 2. Rough placement | H3 cell assignment from image GPS. | H3 |
| 3. **Visual anchoring** | Retrieval + match against Overture building footprints and prior anchored frames → refined 6-DoF pose. **The load-bearing step.** | MegaLoc, ALIKED+LightGlue, hloc |
| 4. Cross-contributor association | FAISS index over MegaLoc descriptors; cluster by cell; Doppelgänger rejection. | FAISS |
| 5. Triangulation | GLUEMAP per cell-cluster → COLMAP sparse reconstruction. | GLUEMAP |
| 6. **Metric scale** | Fuse camera-height calibration, DA3METRIC-LARGE metric depth, known-dimension objects, GPS baseline. Emit scale + its uncertainty per cell. **Highest-risk module; owns its own eval.** | Depth Anything 3 |
| 7. Semantics | SAM 3 open-vocab auto-labeling → human QA → owned training corpus → distilled production segmenter. Curb-ramp head bootstrapped RampNet-style from municipal coordinates. OCR for sign text. | SAM 3, PaddleOCR, municipal data |
| 8. Fusion | Merge to world-state. Confidence from corroboration count, geometric residual, and scale uncertainty. **Measurement-wins rule** with anomaly flag. Freshness decay. | — |
| 9. Aerial prior | Tile2Net sidewalk polygons where ground coverage is thin — served as *inferred*, never measured. | Tile2Net |

**Exit gates:** Tier A bars met on the benchmark corridor (curb-cut P≥90/R≥85, surface ≥90%,
hazard recall ≥90%, position ~2 m). Tier B width MAE ≤0.3 m — the published floor — with a
credible path to 0.15 m. Every element carries confidence and provenance. Tier C emits only
low-confidence "verify on-vehicle" flags, enforced by a schema constraint.

## Stage 2 — Capture client (weeks 10–20, parallel from Stage 1 exit gate)

Phone-first, because the Meta publishing channel is not GA.

| Deliverable | Detail |
|---|---|
| Capture SDK (iOS + Android) | Trigger engine: motion activity (OS API) ∧ (novelty ∨ scene-change). Burst at 3–5 fps. Hardware AVIF/HEVC encode. Background resumable upload, Wi-Fi default. |
| Coverage service | Serves the H3 staleness bitmap that drives the novelty trigger; the feedback loop from Layer C back to Layer A. |
| On-device redaction | EgoBlur before upload. Not deferred — it is Apache 2.0 and it removes the largest legal overhang for the cost of an integration. |
| Camera-height estimation | ARKit/ARCore ground plane + profile calibration walk. Feeds the scale module directly. |
| Consent + provenance | Contributor agreement granting ingest and resale rights; per-capture provenance record. Legal review before any public release. |
| Glasses adapter | Meta Wearables Device Access Toolkit behind the same capture interface, enabled when publishing GA lands. |

**Exit gate:** a captured walk flows end-to-end and lands facts that pass the checker at parity
with Mapillary-sourced facts for the same corridor.

## Stage 3 — Production pipeline (weeks 16–26)

Orchestration (Prefect/Temporal), spot-GPU workers, per-stage idempotency and replay,
backfill-safe versioning, and full lineage: every served fact traces to its contributing frames
and the pipeline version that produced it. Cost controls: raw imagery lifecycle-expired after
fusion; per-cell compute budget.

**Exit gate:** a corridor reprocesses from raw to served facts unattended, with the checker
gating promotion, and the whole run reproducible from its run ID.

## Stage 4 — Distribution (weeks 22–34)

- **Robot API** — OpenAPI + gRPC over the facts table. Corridor and route queries returning
  geometry + semantics + confidence + measured/inferred + freshness on **every** element.
  Freshness SLA tiers. Per-region and per-query metering.
- **Consumer app** — MapLibre + OpenFreeMap tiles, Valhalla pedestrian routing over the fused
  network, coverage credit and badges to steer capture. Rendered maps only; never raw imagery.
- **Municipal export** — OpenSidewalks/TDEI-conformant dumps. Nearly free given the Stage 0
  schema choice, and possibly the first revenue (see comparables §3).

## Stage 5 — Production hardening (weeks 30–40)

SLOs and error budgets on the API; abuse and spoofing defenses on ingest (a paid contributor
network attracts fabricated captures — Bee Maps' token model is instructive here); Postgres HA,
PITR, tested restores; security review; SOC 2 path if selling to fleet operators; legal sign-off
on the ODbL Produced Work boundary, the CC BY-SA attribution obligations for Mapillary-derived
work, biometric law in the operating jurisdictions, and the contributor agreement.

## Stage 6 — Commercial (months 8–12)

Ratify the real accuracy bar with the design partner — the spec is explicit that the §8.5 numbers
are defensible targets, not fixed requirements, and that the ratification conversation is itself a
gate. Target Serve Robotics first. Run the municipal track in parallel; it converts on Tier A
alone and funds the density needed for Tier B.

**Commercial gate:** Tier A ≥95% of traversable path, hazard recall ≥90%, Tier B on ≥80%,
freshness <30 days — as accepted by the partner.

---

## Critical path and where it breaks

The critical path runs: schema → ground-truth checker → **anchoring** → **metric scale** → Tier B.
Both bolded steps are single points of failure and neither is de-risked by published work:

- **Anchoring** determines every downstream position. No published result reaches sub-meter from
  crowdsourced RGB without Google's VPS, which is legally unavailable here.
- **Metric scale** determines every Tier B number, and UrbanVGGT's ablation says it dominates.

Both should be prototyped in the first four weeks, before the surrounding pipeline is built, and
both need their own eval independent of the end-to-end gates. If sub-meter positioning does not
land, the product is still viable — Tier A semantics at ~2 m plus municipal export is a real
business — but it is a different business, and that should be known by week 8, not month 6.
