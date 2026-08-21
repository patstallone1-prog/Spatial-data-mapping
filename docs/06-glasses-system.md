# Glasses System — Capture, Transfer, Accuracy

Built 2026-08-20. Python reference in `src/smc/{capture,mapping,adapters}`, device client in
`clients/glasses-android/`. 153 tests, lint clean.

```bash
python -m smc.adapters check     # what credentials are missing
python -m smc.adapters list      # every service, cost, and commercial-safety
```

---

## 1. Capture (Layer A)

`smc/capture/trigger.py`, ported to Kotlin in `capture/TriggerEngine.kt`. The Python version is
the reference and is what gets tested against simulated drives; the Kotlin one runs on the
battery. They are kept structurally identical so a policy change is the same diff twice.

**The correction the maths forced.** The trigger was first written on a clock, at 4 Hz. At
walking pace that puts consecutive frames **0.35 m apart** — 98% overlap and a baseline far too
short to recover depth at kerb range. Capture is now gated on **distance travelled**, not
elapsed time:

| Speed | Effective rate | Frame spacing |
|---|---|---|
| 1.4 m/s (walking) | 1.83 Hz | 0.76 m |
| 5.0 m/s (cycling) | 4.00 Hz | 1.25 m |
| 8.0 m/s (vehicle) | 4.00 Hz | 2.00 m |
| 15.0 m/s | 4.00 Hz | 3.75 m |

Distance-gating holds the baseline roughly constant, which is the property triangulation needs,
and it cuts a walking wearer's frame count by ~55% — battery saved exactly where the frames were
most redundant. A known limit, asserted in the tests: above ~16 m/s the 4 Hz cap can no longer
hold the 4 m matching ceiling, so fast driving needs a higher cap.

**Your premise, implemented.** A wearer riding in a car at 35 m/s captures **zero** frames,
suppressed on motion state before any geometry is evaluated. The same rule excludes a rig
smearing past at the same speed. One check, two failure modes.

**Every rejection is recorded.** `reason_histogram` gives the suppression distribution over a
session. A trigger that silently declines is undebuggable in the field, and the distribution is
itself the diagnostic for whether the policy is working.

**Novelty needs the server.** A wearer cannot know a cell is stale. `CoverageIndex` mirrors a
server-pushed H3 bitmap — the feedback loop from the fusion engine back to capture, and the
mechanism that steers coverage toward corridors a partner is paying for. A cache miss reads as
*uncovered*: capturing a redundant frame costs one upload, skipping a genuinely novel cell costs
coverage that may not come round for weeks.

## 2. Transfer (Layer B)

`transfer/UploadQueue.kt`. No codec is written — stills go through platform AVIF/WebP, bursts
through the hardware HEVC encoder. Three policies carry the weight:

- **Redact on device, before queueing.** EgoBlur is Apache 2.0 and purpose-built for egocentric
  imagery. The re-spec defers privacy; deferring it *here* would mean choosing to upload
  unredacted bystanders to save a day of integration.
- **Never block capture on the network.** Frames journal to disk; a separate worker uploads.
  A capture path that awaits an HTTP response drops exactly the dead-zone novel cells worth most.
- **Spend the metered link in priority order.** Highest cell priority first, then oldest. When
  the journal bound is hit, the *lowest-priority oldest* frames are evicted — never the newest.

## 3. Accuracy (the part that decides whether any of this works)

`smc/mapping/scale.py` fuses five scale sources by inverse-variance weighting after MAD outlier
rejection. Scale error is **multiplicative**, so it sets how far Tier B can reach:

| Configuration | Scale σ | ±0.15 m holds to |
|---|---|---|
| Vehicle rig (stereo + depth + known object) | 0.96% | **15.6 m** |
| Glasses (camera height + metric depth) | 2.43% | **6.2 m** |

**This is the clean architectural conclusion.** Glasses cannot carry Tier B across a traffic
lane — and they do not have to. A wearer stands *on* the footway, 1–3 m from the curb, well
inside 6.2 m. The vehicle rig owns the roadway vantage because it can carry an independent
anchor (a rigid stereo baseline); the wearer owns the footway vantage. The glasses estimate is
flagged `no_independent_scale_anchor`, and that flag is the honest statement of the difference.

**Disagreement is never averaged.** Two confident sources that contradict each other mean one is
wrong; returning their mean produces a confident, incorrect measurement. Conflicts raise
`scale_disagreement` and inflate σ by √χ²ᵣ. A misidentified object — a scale source that is
excellent when right and catastrophic when wrong — is rejected by MAD before weighting.

**Corroboration counts contributors, not frames.** `smc/mapping/confidence.py` weights repeat
views from one wearer by 1/√n. Forty frames from one person share a device, a calibration, a
moment of weather, and one GNSS bias — and that bias is precisely why averaging a burst does not
help. Counting them as forty corroborations would manufacture confidence from a single observer,
the most dangerous failure available to a system selling corroborated measurement.

**Tier C is advisory in two places.** The confidence model caps it at 0.45 and the `WorldFact`
validator rejects a Tier C fact claiming `MEASURED`. Belt and braces, because this is the rule
most likely to be quietly lost in a migration.

## 4. Testing against the simulator

`device/GlassesSession.kt` abstracts the camera behind `CameraSource`, with two implementations:
the real DAT stream and the **Mock Device Kit**, which accepts an H.265 file as the simulated
feed and behaves identically to real hardware from the app's perspective.

So the chain closes: **CARLA renders a drive → encode H.265 → Mock Device Kit replays it as the
glasses camera.** One synthetic scene with exact ground truth exercises the vehicle path and the
glasses path, no hardware, no field time. Android needs an FFmpeg transcode first; iOS converts
automatically.

## 5. APIs to sync

Run `python -m smc.adapters check`. Four are required before anything runs:

| Variable | Service | Why |
|---|---|---|
| `MAPILLARY_ACCESS_TOKEN` | Mapillary API v4 | Anchor imagery. Free, commercial-safe |
| `HUGGINGFACE_TOKEN` | Hugging Face | DA3METRIC-LARGE, SAM 3, MegaLoc, VGGT-1B-Commercial |
| `SMC_DATABASE_URL` | Postgres + PostGIS | The facts store |
| `SMC_OBJECT_STORE_URL` | GCS or S3 | Transient imagery |

Optional but useful now: `GOOGLE_MAPS_API_KEY`, `GOOGLE_ARCORE_API_KEY`, `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_APPLICATION_CREDENTIALS`, `META_WEARABLES_APP_ID`, `PROJECT_SIDEWALK_BASE_URL`,
`OVERTURE_S3_REGION`, `RTK2GO_MOUNTPOINT`, `MAPTILER_API_KEY`, `VERTEX_AI_LOCATION`,
`SMC_ANCHOR_INDEX_URL`.

**On using the Google stack.** You decided this build never ships commercially, so Street View
and ARCore Geospatial are in — ARCore in particular solves anchoring outright, free, in 87+
countries. Two guards keep that decision from leaking:

- Providers carry a `commercial_safe` flag, and selecting an unsafe one requires passing
  `allow_internal_only=True` at the call site. It is an argument, not a config string, so the
  unsafe path is always visible where it is used.
- `python -m smc.adapters check` prints a **CONFIGURED BUT NOT COMMERCIAL-SAFE** section.

The swap to the commercial path is a provider name plus a credential — not a rewrite. That is
the only reason using Google here is safe to do.

**One thing the credential audit surfaced.** The `visual_positioning` capability had no
commercial-safe provider at all, because that stack does not exist yet — it is the critical-path
module. `SMC_ANCHOR_INDEX_URL` is registered with that stated plainly in its purpose text:
setting the variable does not make anchoring work.

## 6. What is not built

- **The anchoring stack** (`OwnedAnchoring`) raises `NotImplementedError`. It is the single
  largest open risk in the project: no published method reaches sub-metre from crowdsourced RGB
  without Google's VPS.
- **The DAT and Mock Device Kit bindings** raise with instructions. The toolkit is developer
  preview with publishing GA targeted for 2026, so the binding surface is the most likely to move.
- **Depth, segmentation and OCR adapters** are interfaces only; weights are identified and
  licence-cleared in `01-dependency-stack.md`.
