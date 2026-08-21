# Camera-Only Fusion Mapping Network — Technical Re-Spec

**Version:** Camera-only ("no spatial data"), gate-driven build
**Date:** August 20, 2026
**Premise:** Assume Meta never exposes depth, IMU, or spatial data. The app receives **only a plain RGB camera feed** from the glasses plus the **phone's own** GPS and motion sensors. All accuracy is manufactured in software from ordinary camera views. Privacy and Meta publisher-access issues are **explicitly deferred** for this version.

---

## 0. The one-paragraph version

People wear camera glasses and walk around. Their phone app grabs a few smart-timed pictures per second during high-value moments, compresses them with the phone's built-in encoder, and uploads them cheaply. In the cloud, a **fusion engine** figures out which pictures — across many different people, at different times — show the same physical spot, anchors them to an existing street map, and triangulates geometry from the overlapping views. The output is not pictures; it's a living table of **world-facts** ("curb cut present here; sidewalk ~4 ft; concrete; possible step hazard mid-block") with a confidence score and a measured-vs-inferred tag on every element. That table feeds a free consumer map and a paid robot-navigation API. The fusion engine is the only novel, defensible part; everything else is commodity or standard plumbing.

---

## 1. What each layer does — and who builds it

| Layer | Job | Build it yourself? |
|---|---|---|
| A — Smart capture | Decide *when* to take pictures | Yes — small, high-value |
| B — Compression & upload | Get pictures off the device cheaply | **No** — use the phone's built-in encoder |
| C — Fusion engine | Turn many overlapping pictures into accurate world-facts | **Yes — this is the whole company** |
| D — Distribution | Serve the consumer map + robot API | Yes — standard software |

---

## 2. Layer A — Smart Capture ("aware software")

Never stream continuous video. Fire a still (or a short low-framerate burst) only when a trigger is true:
- **Motion-appropriate** — the person is walking/cycling (from the phone's motion sensor). Suppress while stationary or in a vehicle.
- **Novelty** — they've entered a map cell that is uncovered or stale. Highest-value trigger.
- **Scene-change** — the current view differs enough from the last capture to be worth recording.

Rate: a few frames per second during an active trigger. (Notably, commercial sidewalk robots like Starship run their own cameras at roughly 3–5 frames per second — the same order you're targeting.)

---

## 3. Layer B — Compression & Upload (use the commodity, don't build it)

Writing every pixel's color out as text makes the data *larger*, not smaller — a raw image already *is* the numeric color of every pixel. The working version of "turn the image into a compact recipe that rebuilds it" already ships on every phone:

- **Stills →** WebP/AVIF (roughly 10–50× smaller, near-lossless).
- **Sequences →** the phone's built-in H.265/AV1 hardware encoder. This *is* the "copy the previous frame, adjust for movement, only replace the changed boxes" idea — motion-compensated delta encoding, done on dedicated silicon, essentially free.
- **Region-of-interest trimming (later refinement)** — down-weight sky/blurred background, preserve the ground plane and curb line.

You do not build a compression algorithm. You call the encoder the phone already has.

---

## 4. Layer C — The Fusion Engine (your only real IP)

Depth is *manufactured* from many overlapping views — no depth sensor. Eight steps:

1. **Ingest** — each capture with its phone GPS, motion reading, timestamp.
2. **Rough placement** — GPS puts each picture on approximately the right block (meters of error; worse in downtown canyons). Not precise enough alone — Step 3 fixes it.
3. **Visual anchoring (snap to the map)** — match fixed features in the picture (building corners, storefront edges, signs) against an existing street map / existing imagery to refine position to sub-meter and recover which direction the camera pointed. This is the load-bearing accuracy step.
4. **Cross-contributor association** — determine which captures, across people and days, show the same physical spot (visual-fingerprint matching, not raw-pixel comparison).
5. **Multi-view triangulation** — from several overlapping views of the same spot, compute 3D geometry (curb height, sidewalk width, ramp location). Mature off-the-shelf software class (photogrammetry / structure-from-motion); integrate and tune, don't invent.
6. **Semantic labeling** — segmentation + text-reading (OCR) models label curb, curb-cut, sidewalk, driveway apron, sign text, surface, obstacle.
7. **Fuse into the world model** — merge into a versioned world-state; every element carries **confidence**, **measured-vs-inferred**, **freshness timestamp**, **corroboration count**. More independent views → higher confidence; elements decay until re-observed. **Rule:** when a fresh measurement disagrees with the map/standard, the *measurement wins* and the disagreement is flagged — never smooth a real anomaly (broken/missing curb) back to the code ideal.
8. **Serve** — two read layers (Layer D).

**Why this survives whatever Meta does:** the engine's input is "a camera view, from somewhere, with a rough position." It doesn't care whether the camera is Meta glasses, Snap Spectacles, or Android XR. Real depth, if ever exposed, just arrives as a higher-confidence observation into the same engine — upside, never a dependency.

---

## 5. Layer D — Distribution

**Consumer app (free, growth flywheel):** routing, POIs, AR wayfinding, crowd-verified freshness. Doubles as the wearer capture app; capturing earns coverage credit/badges. Consumers see rendered maps/routes only — never raw imagery or the full geometry layer.

**Robot navigation API (paid, revenue engine):** queries against geometry + semantics — sidewalk width/surface, curb height and cut locations, static obstacle/hazard flags — with confidence + measured-vs-inferred on **every** element. Per-region or per-query pricing; freshness SLA tiers.

---

## 6. The two representations

- **Transport representation** (moving data off the device): compressed image/video via the phone's encoder. Pixel-accurate, temporary, discarded after fusion. Commodity.
- **Product representation** (what you store and sell): the world-facts table — geometry + labels + confidence + provenance. Tiny, permanent. This is where the "instruction manual" idea belongs — describing the *place*, not the *pixels*.

---

## 7. Coverage & accuracy economics

Multi-view triangulation needs **overlap** — several people passing the same spot from different angles. So accuracy is *emergent and geographic*: poor where coverage is thin, strong where traffic is dense. The product is weakest exactly where you have fewest users.

**The saving grace:** dense-traffic corridors are *both* where wearers walk *and* where robots deliver — coverage concentrates where the paid value is. You don't need the whole city; you need the busy corridors measured well, first. Steer wearers there with the novelty trigger (Layer A).

---

## 8. Achievement Thresholds & Accuracy Gates

This section replaces a standalone proof phase. Instead of proving the engine once, you **build against measurable gates continuously** — a fact is not served at "measured/high-confidence" until it clears the bar for its tier against spot-checked ground truth.

### 8.1 The three reference points (researched)

**(a) Ground-truth tolerances — the standards a robot/wheelchair cares about.**
- Vertical level change (trip/mobility hazard threshold): **¼ inch (6 mm)**. Below this = passable; ¼–½ in must be beveled; over ½ in needs a ramp. This is the single hardest number.
- Curb ramp running slope: **max 8.33% (1:12)**; cross slope: **max ~2.08% (1:48)**.
- Minimum clear width: **36 in (ADA) / 48 in (newer PROWAG)**.
- Typical curb height: **~6 in**; detectable-warning domes: 0.9 in dia, 0.2 in high.

**(b) What robots actually run on.**
- Starship builds local maps to roughly **one-inch (~2.5 cm)** and localizes to about **10 cm**, using ~12 cameras + sensor fusion.
- Coco / Niantic Spatial operate on **centimeter-scale** pose from a shared visual "living map."
- Plain GPS is **meter-level**; RTK-corrected GPS reaches **~5 cm**.
- **Key implication:** the robot supplies its *own* centimeter localization for the final meter. Your map does **not** need to match that. Your map supplies the layer the robot lacks: fresh, ahead-of-vehicle **semantic + coarse-geometry** context. Set targets by what your map uniquely provides, not by the robot's local precision.

**(c) What crowdsourced RGB actually achieves today.**
- Raw crowdsourced camera positions are noisy: measured mean deviation of **~5.5 m** from true position; "several meters" is typical, worse in canyons.
- Monocular depth models are most reliable **within ~20 m** of the camera.
- Triangulation needs an object in **≥2–3 overlapping images**; accuracy improves with image count.
- *Classification* (what a thing is) is already strong: **~87–98%** precision on signs/surfaces. *Positioning* (where it is precisely) is the hard part.
- The proven real-world fix for the position noise is **exactly your instinct**: anchor to known road geometry, weight fresher footage, and cross-check reference/council data. This is how production crowdsourced maps mitigate GPS drift today.

### 8.2 The gap, stated plainly

Raw crowdsourced RGB + phone GPS gives feature positions good to **a few meters**. Robots run on **centimeters** locally. That is a ~100× gap on *absolute* position — but you do not have to close it, because (1) the robot closes the final meter with its own sensors, and (2) map-anchoring + multi-view density pull your positions from meters toward **sub-meter**, which is the regime your product needs to live in.

### 8.3 Tiered accuracy gates (build in this order)

**Tier A — Semantic presence (build and ship first; achievable now):**
- Curb-cut / ramp presence detection: **precision ≥ 90%, recall ≥ 85%**
- Sidewalk presence + surface class (paved/unpaved/broken): **≥ 90% correct**
- Static obstacle / hazard *presence* flag: **recall ≥ 90%** (bias to false alarms over misses)
- Absolute position of each feature after map-anchoring: **within ~2 m**

**Tier B — Coarse geometry (build second; requires image density):**
- Sidewalk width: **within ±0.3 m**
- Curb height *bucket* (none / low <3 in / standard ~6 in / high): **correct bucket ≥ 85%**
- Ramp running-slope *category* (compliant ≤8.33% vs not, i.e. ±2% absolute): **≥ 85% correct**
- Feature position after multi-view fusion: **within ~0.5–1 m**

**Tier C — Hazard-grade fine geometry (do NOT promise from crowdsourced RGB):**
- ¼-inch (6 mm) vertical-step detection, sub-1% slope precision: **beyond reliable crowdsourced reach.** Output these only as **low-confidence "possible hazard — verify on-vehicle"** flags, never as measured guarantees. The robot's own sensors own this tier.

### 8.4 Gate mechanics (how you build against them)

- **Promotion rule:** a fact is served as "measured/high-confidence" only after **N independent contributors** corroborate it *and* it passes its tier's bar against spot-checked ground truth. Below that, it's served as "inferred/low-confidence" or withheld.
- **Ground-truth checking:** periodically measure a sample of served facts against real values (tape measure / known municipal data / a calibrated reference walk). Compute the error distribution. The tier bar is a pass/fail on that sample — this is the "real measurement accuracy" you build against.
- **Density gate:** track images-per-cell. Below the multi-view threshold, serve only Tier A (semantic) for that cell and withhold Tier B geometry.
- **Freshness gate:** decay confidence after the staleness window; prioritize re-capture.
- **Coverage gate:** % of a target corridor at Tier B before that corridor is offered to a robot partner.

### 8.5 Commercial gate (ties accuracy to revenue)

A pilot corridor is "sellable" to a robot partner when, on the traversable path:
- Tier A coverage **≥ 95%**, hazard-flag recall **≥ 90%**
- Tier B geometry present on **≥ 80%** of the path
- Freshness **< 30 days**

**Important honesty note:** the *exact* numbers above are defensible targets derived from the three reference points — but the true required bar depends on the specific robot partner's own sensor suite (a robot with strong local sensing needs less from your map; a minimal robot needs more). **Ratify the real numbers with your first robot design partner** rather than treating these as fixed. That conversation is itself a gate.

---

## 9. Phased build (no standalone proof phase — gates run throughout)

| Phase | Timeframe | Milestones | Gate to advance |
|---|---|---|---|
| **1 — Build** | Months 0–3 | Build Layers A + B + C. Run the engine on self-captured walks + existing open street imagery. Instrument the ground-truth checker from day one. | Tier A bars met on one test area; engine emits confidence + provenance per element. |
| **2 — Pilot corridor** | Months 3–6 | 10–50 opt-in wearers over one dense corridor. Push that corridor from Tier A into Tier B. Stand up the robot API read layer. | Tier B bars met on the corridor's traversable path; density gate satisfied. |
| **3 — Robot design partner** | Months 6–12 | Onboard one delivery-robot operator. **Ratify the real accuracy bar** against their sensor suite. Free consumer beta to grow wearers. | Commercial gate (8.5) met and accepted by the partner. |

---

## 10. Deferred (bracketed for this version, not solved)

- **Bystander privacy / biometric law** — the transport layer temporarily holds imagery; the "store only world-facts" product design mitigates it, but on-device redaction + legal review return before public operation.
- **Meta publisher / partner-tier access** — needed only to *distribute* a glasses app publicly. The hardware-agnostic engine is the hedge.
- **SDK commercial terms** — commercial ingest/resale of wearer captures needs legal review before scale.

---

## 11. Competitive reality to build against

A well-funded incumbent is already building the "world-model API for robots": **Niantic Spatial**, whose shared centimeter-scale "living map" is exposed via API to robots/phones/headsets, with **Coco Robotics** (≈1,000 sidewalk robots) as its first large deployment. They capture via robot-mounted cameras and repurposed AR game data, not passive glasses wearers.

This is both **validation** (the model is real and being funded) and a **flag** (you are not first to the concept). Your differentiation is the **capture layer**: passive, hands-free glasses wearers can cover far more sidewalk, far more often, than a robot fleet retracing its own delivery routes — *if* the wearer network materializes. The bet is that broader, fresher passive coverage beats a robot fleet's self-captured coverage. Build the fusion engine to be capture-agnostic so you can out-cover them regardless of which glasses open up.
