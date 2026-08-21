# Comparables, Prior Art & What to Target

Compiled 2026-08-20.

---

## 1. Direct competitors

### Niantic Spatial — the incumbent on *localization*
- Spun out of Niantic with **$250M**; CEO John Hanke.
- **Large Geospatial Model** built on **30+ billion posed images** from millions of locations,
  sourced largely from Pokémon GO players and Scaniverse scans.
- **VPS 2.0** — precise position and orientation from ground and aerial capture, including
  where GPS fails.
- **NSDK 4.0** (April 2026): unified SDK across Unity, Swift, Android, and **ROS 2** — the ROS 2
  target is the robotics play, explicit.
- First major robotics customer: **Coco Robotics** — ~1,000 delivery bots in five cities,
  targeting 10,000 in 2026, $123M raised. Niantic VPS gives Coco precise positioning at
  restaurant pickup and customer doorstep.

**Read:** they have won the positioning layer and are not beatable there. 30B posed images and
centimeter VPS is not a gap that a new wearer network closes. Their capture is games and scans
— *incidental* coverage, dense where people play, and it is not oriented to the pedestrian
right-of-way. They map **where things are**, not **what the sidewalk is like**.

### Bee Maps (formerly Hivemapper) — the closest *business model* comparable
- Crowdsourced dashcam network, DePIN with **HONEY** token: contributors earn tokens, developers
  burn tokens to consume data.
- **8,000+ dashcams, 90+ countries, 80M+ road kilometers** mapped.
- Raised **$32M** (Pantera, LDA, Borderless, Ajna).
- Moved from $589 hardware upfront to **$19/mo bundled subscription** (hardware + LTE + fleet
  software, 24-month term) to lower contributor friction.
- Customers: **Lyft** (routing + autonomous strategy), **Volkswagen's AV unit** (robotaxi mapping),
  plus NBCUniversal, Mapbox, HERE. CEO describes **six- and seven-figure deals**.

**Read:** this is the proof that crowdsourced camera-only mapping sells, at real contract sizes,
to real logistics and AV buyers. It is also the proof that the incentive layer is the hard part —
they needed a token *and* then had to subsidize hardware to keep contributors. Critically:
**they map roads, from vehicles.** The sidewalk is not in their coverage model.

### The robot demand side (the buyers)
| Operator | Scale as of 2026 | Notes |
|---|---|---|
| **Starship** | 5,500+ units (Q2 2026, largest single fleet); ~2,700 across 150+ locations in six countries by another count; **9M+ autonomous deliveries**; raised $50M | Campus-dominant. Runs ~12 cameras, builds local maps to ~1 in (2.5 cm), localizes to ~10 cm. |
| **Serve Robotics** | **2,000+ robots**, largest US fleet, 20× growth in a year — LA, Atlanta, DFW, Miami, Ft. Lauderdale, Chicago, Alexandria | The most likely first design partner: fast-expanding into *new* cities, so it needs fresh sidewalk priors it does not already own. |
| **Coco** | ~1,000, targeting 10,000 | Already locked to Niantic. |
| **Cartken, Yango** | Emerging | Yango via the Noon platform. |

Sidewalk delivery is described in 2026 as the fastest-growing segment of last-mile automation,
with five major operators. **The buyer list is small, named, and reachable.** That is good — a
design partner is a phone call, not a funnel — and bad: three or four accounts is the entire
near-term market, and one is already captive to Niantic.

---

## 2. Published prior art — the numbers that reset the targets

### UrbanVGGT (Tan & Zhang, arXiv 2603.22531, revised Aug 19 2026)
Metric sidewalk width **from a single street-view image**: semantic segmentation → feed-forward
3D reconstruction → adaptive ground-plane fitting → **camera-height-based scale calibration** →
directional width measurement on the recovered plane.

- **MAE 0.252 m**; **95.5% of estimates within 0.50 m** on a Washington DC ground-truth benchmark.
- Ablation: **metric scale calibration is the most critical component.**
- Produced SV-SideWidth across three cities, 527 OSM segments.
- Authors' own caveat: cross-city validation and local ground-truth auditing remain necessary
  before use as authoritative planning data.

**This changes the plan.** The spec's Tier B target — sidewalk width within ±0.3 m — is already
met by a *published, single-image* method that needs no multi-view overlap at all. Two
consequences: (1) Tier B is no longer gated on contributor density, which removes the coldest
part of the cold-start; (2) ±0.3 m is no longer a differentiating target, it is the table stakes,
and the target should move to **±0.15 m with multi-view corroboration**.

### RampNet (Project Sidewalk, arXiv 2508.09415)
Two-stage curb ramp detection bootstrapped from open government metadata: stage 1 auto-translates
municipal curb-ramp coordinates into image pixels (ConvNeXt V2), generating labels; stage 2 trains
a panorama detector.

- Dataset: **214,376 labeled panoramas, 849,895 curb ramp labels** (NYC, Portland OR, Bend OR).
- Stage 1 auto-labeling: **P 94.0% / R 92.5% / F1 0.932**.
- Stage 2 detection: **AP 0.9236**, versus prior SOTA **0.380**.
- Code and datasets open, CC BY 4.0.

**Read:** the spec's Tier A target (curb-cut precision ≥90%, recall ≥85%) is confirmed achievable
— and the *bootstrapping trick* is the real prize: municipal open data can auto-generate the
training labels, so the semantic layer does not need a hand-labeling budget. Caveat from §0.1 of
the stack doc: their imagery is Street View, so replicate the method against Mapillary and own
captures, not their panoramas.

### MapAnything (Carnot et al., arXiv 2509.14839, v3 Jul 2026)
Geocoding urban assets (signs, road damage) from a **single monocular image** via metric depth
estimation plus camera geometry, validated against high-precision LiDAR, with error broken out
by distance interval and semantic region.

**Read:** independent confirmation that monocular metric depth is a viable positioning primitive
for street furniture, and a ready-made evaluation methodology for the ground-truth checker.

### Project Sidewalk (UW)
50+ cities, 10 countries, six languages, **3.4M+ contributor-labeled points**, fully open in
CSV/GeoJSON and via API.

**Read:** both a free ground-truth source and a cautionary comparable — it is the human-labeling
version of this idea, it has run for years, and it has *not* converted into a robot-navigation
business. The gap it never closed is exactly the one this project must close: **geometry and
freshness, not labels.**

---

## 3. What this means for targeting

**The wedge is not localization, and it is not the capture hardware.** The spec bets on
"passive glasses wearers out-cover a robot fleet." Two problems with that as stated: the Meta
Wearables toolkit is still developer-preview with publishing GA only *targeted* for 2026, so the
channel does not exist yet; and Niantic already out-covers everyone with 30B images.

The defensible wedge is **pedestrian right-of-way attributes**: sidewalk width, surface, curb
height, ramp presence and slope, obstruction — measured, fresh, and confidence-tagged. Niantic
maps position. Bee Maps maps roads. Project Sidewalk labels accessibility but does not measure
geometry or maintain freshness. **Nobody is producing metric sidewalk geometry at scale**, and
the published research shows it is now technically reachable from ordinary RGB.

### Revised targets

| | Spec target | Evidence | Revised target |
|---|---|---|---|
| Curb-ramp presence | P ≥90 / R ≥85 | RampNet AP 0.9236 | Keep; treat as a solved-in-principle integration, not research |
| Sidewalk width | ±0.3 m | UrbanVGGT MAE 0.252 m single-image | **±0.15 m** with multi-view; ±0.3 m single-image as the floor |
| Feature position (Tier A) | ~2 m | Achievable via Mapillary anchoring | Keep |
| Feature position (Tier B) | 0.5–1 m | **No published result achieves this from crowdsourced RGB without Google VPS** | Keep as the genuine research risk — this is the one number that is not de-risked |
| Curb height bucket | ≥85% | Analogous to width via same scale pipeline | Keep |
| Freshness | <30 days | Bee Maps sells on freshness; it is their pitch | **Make freshness the headline metric**, since it is the one axis where a passive wearer network genuinely beats both Niantic and a robot fleet |

### Commercial targeting
- **First design partner: Serve Robotics.** Expanding into new cities fastest, not captive to
  Niantic, and has the clearest need for a sidewalk prior it does not already own.
- **Second buyer class, non-obvious and possibly first revenue: municipalities.** ADA transition
  plans are a legal obligation, the TDEI/OpenSidewalks ecosystem already defines the schema and
  hosts 400k miles of sidewalk data, and cities already publish the curb-ramp inventories that
  bootstrap the model. A city pays for an audited sidewalk inventory today; a robot operator pays
  only once coverage exists. This inverts the spec's sequencing and is worth testing early.
