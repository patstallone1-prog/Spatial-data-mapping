# Capture Rig v1 (Vehicle) & the Simulation Stack

Compiled 2026-08-20. Prices are approximate USD and marked **[VERIFY]** where not confirmed
against a live listing during this pass.

---

## 1. Why vehicle-first is right — including an argument stronger than the speed one

The stated case holds: the smart-capture trigger logic is genuinely shared, because a car at
80 mph and a wearer at 80 mph are the same suppression case (one is motion-blurred past
usefulness, the other is filming a dashboard or a seat-back). Motion-gating, novelty-gating,
and scene-change gating port over unchanged. Camera height is close enough — a windshield mount
sits ~1.2–1.4 m, glasses sit ~1.6 m — that the scale pipeline is the same pipeline with a
different constant.

Two arguments for it that are stronger:

**Every piece of published prior art in this field is roadway-vantage.** UrbanVGGT measures
sidewalk width from street-view images shot from the road. RampNet detects curb ramps in
street-view panoramas shot from the road. Mapillary's corpus is overwhelmingly vehicle capture.
A vehicle rig is not a compromise proxy for the glasses — it is *the vantage the literature
already validates*, and glasses are the unproven one. Building glasses-first would have put the
unvalidated vantage on the critical path.

**A vehicle can carry sensors a face cannot, and that kills both critical-path risks.** The
build-order doc names two undecided risks: absolute positioning without Google's VPS, and metric
scale. A car roof carries an RTK GNSS antenna; a person's temple does not. A car dash carries a
synchronized stereo pair on a rigid 20 cm baseline; a pair of glasses does not. So:

- **RTK GNSS → centimetre absolute position.** Risk #1 dissolves on the vehicle rig.
- **Stereo baseline → metric scale, deterministically, from known geometry.** Risk #2 dissolves
  too — no reliance on camera-height priors or monocular depth inference.

That reframes the vehicle version. It is not just a faster proof of concept. **It is the
permanent survey backbone of the product.** The RTK-surveyed, stereo-scaled facts it produces
become the reference layer that later monocular glasses captures localize *against* — and the
calibration set that tells you how far the monocular pipeline drifts from truth. The glasses
network then adds what a car fleet cannot: coverage of paths no car drives, and freshness.

**What genuinely differs and must be handled:** occlusion by parked cars (mitigated by repeat
passes; note Street View has the same problem and UrbanVGGT still hit 0.252 m MAE), oblique
viewing angle onto the curb line, and no coverage of mid-block interiors, plazas, or campus
paths. Those are exactly the gaps the wearer network is for — which is a cleaner story than
"wearers out-cover robots."

---

## 2. Target camera

**Recommendation: build the rig, don't buy a camera.** No consumer dashcam or action camera
exposes the three things this needs — global shutter, hardware-timestamped frame sync against
GNSS/IMU, and custom on-device trigger logic. A Raspberry Pi 5 with an industrial CMOS module
does, costs the same, and runs the identical Layer A code you will later port to the phone.

### Why global shutter is non-negotiable
A rolling-shutter sensor reads the frame top-to-bottom over ~10 ms. At 15 m/s that is ~15 cm of
scene motion smeared across a single exposure — larger than the entire Tier B error budget, and
it corrupts the feature geometry that SfM depends on. Global shutter exposes every pixel at once
and removes the problem rather than modelling it.

### Tier 1 — "Proxy rig" (~$300 **[VERIFY]**)
Deliberately GPS-limited to *match what a glasses wearer's phone will have*. This is the honest
software proof.

| Item | Part | Approx cost |
|---|---|---|
| Compute | Raspberry Pi 5, 4–8 GB | $60–80 **[VERIFY]** |
| Camera | **Arducam Pivariety AR0234** — 2.3 MP global shutter, 1920×1200 @ 60 fps, 1/2.6" Onsemi sensor, M12 mount, 3.6 mm f/3.0, 90° HFoV, supports Pi 5 | **£105.60 inc VAT** (confirmed, The Pi Hut) |
| GNSS | u-blox NEO-M9N module | ~$60 **[VERIFY]** — metre-level, deliberately |
| IMU | BNO085 / BNO055 | ~$20 **[VERIFY]** |
| Storage | NVMe via Pi 5 M.2 HAT, 256 GB+ | ~$45 **[VERIFY]** |
| Power | 12 V→5 V 5 A automotive buck with ignition sense + safe shutdown | ~$25 **[VERIFY]** |
| Mount / enclosure | Suction windshield or dash mount, vented case | ~$40 **[VERIFY]** |

### Tier 2 — "Truth rig" (~$700 **[VERIFY]**)
Tier 1 plus the two sensors that make it the survey backbone.

| Add | Part | Approx cost |
|---|---|---|
| Stereo | **Arducam AR0234 synchronized stereo bundle** (2× 2.3 MP global shutter, hardware-synced) on a rigid 15–25 cm baseline | ~$200 **[VERIFY]** — good depth to ~10–15 m, which is exactly the curb-to-camera range from a traffic lane |
| RTK GNSS | **ArduSimple simpleRTK2B** (u-blox **ZED-F9P**) — RTK accuracy **0.01 m + 1 ppm CEP**; ArduSimple cut ZED-F9P board prices permanently as of Aug 7 2026 | ~$200–250 **[VERIFY]** |
| Antenna | Multiband survey antenna, magnetic roof mount | ~$80 **[VERIFY]** |
| Corrections | **RTK2go** free community NTRIP caster — 800+ free base stations live, 11,000+ registered, no rover registration, `rtk2go.com:2101`; plus state CORS networks where they exist | **$0** — coverage limited to ~35–50 km from a contributing base, and uptime depends on volunteer operators |

### Considered and rejected
- **GoPro MAX 2 / Insta360 X5** — Mapillary's Camera Grant Program 3.0 now ships GoPro MAX 2 for
  8K 360° capture, so these are proven for *imagery collection*. But rolling shutter, no custom
  on-device code, no frame-level GNSS sync, and stitched equirectangular output that complicates
  intrinsics. Good for bulk Mapillary contribution; wrong for a measurement instrument.
- **Consumer dashcams** — closed firmware, no trigger control, no sensor sync.
- **comma.ai comma 3X** — technically excellent (cameras + GNSS + IMU + LTE, runs custom code)
  and genuinely car-native, but ~$1,250 and carries an openpilot-shaped software stack you would
  fight. Worth revisiting only if the rig build stalls. **[VERIFY price]**
- **Old Android phone as a headless module** — cheapest path with camera + GNSS + IMU + LTE in one
  $80 used unit. Rejected per your call on phone cameras, and the technical case agrees: rolling
  shutter and no frame-to-GNSS hardware timestamp.

---

## 3. Simulation stack

The ask — build and test digitally against both targets — resolves into two simulators that
chain into one pipeline.

### 3.1 Vehicle: **CARLA**
- Open source; **CARLA code is MIT, CARLA assets are CC-BY**. 0.10.0 migrated from Unreal 4.26
  to **Unreal Engine 5.5** (Lumen + Nanite), with native ROS integration.
- Sensor suite covers everything the rig has and more: **RGB camera, depth camera, semantic
  segmentation camera, instance segmentation camera, optical flow camera, GNSS, IMU**, LiDAR,
  radar — all with configurable intrinsics and mount transforms.
- **The reason this matters more than "it renders streets":** the semantic and instance
  segmentation cameras plus depth give **pixel-exact ground truth for free**. You can drive a
  synthetic route where the true curb height, sidewalk width, and ramp positions are known
  exactly, run the full fusion engine on the rendered frames, and score Tier A and Tier B against
  perfect truth — before a single real mile is driven. That is the ground-truth checker from
  Stage 0 running with zero field cost.

**Two things you must add, or the sim will lie to you:**
1. **Realistic GNSS error.** CARLA's GNSS model is simplistic. Inject the real distribution —
   the ~5.5 m mean deviation and urban-canyon multipath from the research — or the anchoring step
   will look solved when it is not.
2. **Sidewalk asset variety.** CARLA's towns have stylized, repetitive curbs and few ADA curb-ramp
   variants. Passing gates on stock assets proves the plumbing, not the perception. Author or
   import varied curb/ramp assets, or treat CARLA results as necessary-not-sufficient.

### 3.2 Glasses: **Meta Mock Device Kit** (official, part of the Wearables DAT)
- Ships inside the Wearables Device Access Toolkit — SDKs public at
  `facebook/meta-wearables-dat-ios` and `facebook/meta-wearables-dat-android` (v0.6).
- Simulates **camera streaming, photo capture during streaming, permission requests, and device
  state changes** (power, wearing status, configuration).
- **Accepts your own media as the simulated feed:** H.265 video files (the iOS sample app
  auto-converts; Android needs manual FFmpeg transcode), designated photos as capture results,
  or a live phone camera feed.
- Critically: "your app code works the same way regardless of whether it's talking to a real
  device or a mock device" — so the Layer A client is written once against the real interface.

### 3.3 The chain — one synthetic pipeline, both targets
CARLA renders a drive → export as H.265 → feed that file into the **Mock Device Kit** as the
glasses camera stream. The same synthetic scene, with the same perfect ground truth, exercises
the vehicle rig path *and* the glasses client path. Layer A trigger logic, Layer B encode/upload,
and the whole of Layer C get tested end-to-end against known answers, on both hardware targets,
with no hardware and no field time.

Do the same with recorded rig footage once it exists: real drives replay through the Mock Device
Kit as glasses input, which is how you measure the monocular-vs-stereo scale gap directly.

### 3.4 Checked and rejected
**Project Aria / Aria Synthetic Environments** — Meta's research-glasses simulation stack, with
100K procedurally generated scenes simulated with Aria sensor characteristics, 3M 3D bounding
boxes, and the ATEK training framework. Impressive, and **entirely indoor apartment interiors**.
No sidewalks, no curbs, no street scenes. Not applicable here. Worth noting so nobody rediscovers
it hopefully in month three.

---

## 4. What simulation can and cannot prove

**Can:** trigger logic correctness, encode/upload behaviour, pipeline plumbing and idempotency,
retrieval and association logic, SfM convergence, the fusion and confidence math, the promotion
rules, and — with authored assets — a first read on Tier A and Tier B accuracy against exact truth.

**Cannot:** real sensor noise, real rolling-vs-global-shutter behaviour, real lighting and weather
degradation, real GNSS multipath, real occlusion statistics, or how any of the learned models
generalize from rendered to real. Synthetic-to-real gap is the standing caveat; every gate passed
in CARLA is provisional until the same gate passes on a real corridor with tape-measure truth.

**Sequence:** CARLA proves the software is correct → Tier 1 rig proves it survives real sensors at
phone-grade GPS → Tier 2 rig establishes truth and the survey backbone → Mock Device Kit carries
the validated client to the glasses target the day publishing goes GA.

---

## 5. Build-order delta

Amends `03-build-order.md`:

- **Stage 0** gains: CARLA harness with synthetic ground-truth scoring, wired into the same
  checker interface as the municipal/RTK sources. Makes the Stage 0 exit gate reachable in days.
- **Stage 1** unchanged — Mapillary is still the fastest route to a real-imagery engine, and now
  has CARLA as its correctness oracle.
- **Stage 2** is rewritten: capture client v1 targets the **Pi rig**, not the phone. The phone
  build drops to a later port; the Mock Device Kit becomes the glasses target from day one so the
  client is written against the real Meta interface throughout.
- **New Stage 2b — survey backbone:** Tier 2 rig drives the pilot corridor and produces the
  RTK + stereo reference layer. This is what later lets monocular captures reach sub-meter, and
  it is the thing worth owning.
