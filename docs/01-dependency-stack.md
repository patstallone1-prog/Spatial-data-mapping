# Dependency & API Stack

Compiled 2026-08-20. Every entry carries a license and a cost. Rule applied throughout:
**use an API or an existing package; write code only where the IP lives (Layer C fusion logic).**

Items marked **[UNVERIFIED]** were not confirmed against a primary license file during this pass
and must be checked before they enter the build.

---

## 0. Legal ground rules — read before choosing anything

Three findings reshape the architecture. They are not footnotes; they decide the build.

### 0.1 The entire Google stack is off-limits for this business

Google Street View, Maps Platform, and the ARCore Geospatial API are technically ideal for
Step 3 (visual anchoring) — ARCore Geospatial is free, covers 87+ countries, and localizes
against a global point cloud derived from Street View. It is also **legally unusable** for a
company that sells a derived world-facts database:

- Maps Platform terms: customers **"cannot use Google Maps Content to train, develop, or
  improve any machine learning models or artificial intelligence systems."**
- **"Customers will not create content based on Google Maps Content."**
- Pre-fetching, indexing, storing, or caching content is prohibited (panorama IDs and place
  IDs are the only exceptions).
- ARCore Additional ToS: **"You will not use the APIs to create a product or service with
  features that are substantially similar to or that re-create the features of another Google
  product or service."**

Every one of those clauses is aimed at exactly what this product does. **Decision: no Google
data source anywhere in the ingest or training path.** This also means the strongest published
prior art (UrbanVGGT, RampNet — both built on Street View) proves *technical* feasibility but
its *data pipeline* cannot be copied commercially.

### 0.2 ODbL share-alike is survivable, but only by design

OSM and the Overture buildings/transportation themes are ODbL. The critical distinction:

- **Derivative Database** — you adapt, modify, enhance, correct, or extend the data. If you
  distribute it, it stays ODbL. Share-alike bites.
- **Produced Work** — output *created from* the database. "Using this Database … to create a
  Produced Work does not create a Derivative Database." You may license a Produced Work on
  any terms; on request you must offer the underlying data/derivative under ODbL.

The world-facts table must be architected as a **Produced Work**, which means keeping a hard
boundary: OSM/Overture geometry is used as an *anchor reference* during fusion and is **never
merged into, copied into, or extended by** the served facts table. Feature IDs may reference
OSM ways; OSM geometry must not be stored in the product database. Get this wrong once in a
schema migration and the sellable asset becomes ODbL.

### 0.3 The public segmentation datasets cannot train a commercial model

- **Cityscapes** — non-commercial only.
- **Mapillary Vistas** — CC BY-NC-SA. Non-commercial.
- **Synscapes** — non-commercial.

There is no large, permissively licensed street-scene segmentation dataset. **Consequence:**
the semantic layer must be built by auto-labeling *your own and Mapillary imagery* with
open-vocabulary models that carry commercial licenses (SAM 3, Grounding-DINO-class), then
human-QA'd. That labeled corpus becomes an owned asset — arguably a second moat, and a
line item in the build, not an afterthought.

---

## 1. Layer A — Smart capture

| Need | Choice | License / cost | Notes |
|---|---|---|---|
| Glasses camera feed | **Meta Wearables Device Access Toolkit** | Free SDK; publishing gated | Public **developer preview** — POV camera, photo/video, audio. Ray-Ban Meta + Oakley Meta HSTN supported. Only select partners may publish; **general availability for publishing targeted 2026**. Not yet a shippable channel. |
| Fallback capture (near-term) | Phone camera, pocket/mount | Free | The glasses channel is not GA. Build capture hardware-agnostically and ship phone-first. |
| Motion / activity trigger | iOS **CMMotionActivityManager**; Android **Activity Recognition Transition API** | Free, OS-level | Gives walking / cycling / vehicle / stationary directly. Do not write a classifier. |
| Device pose + gravity | **ARKit** / **ARCore** session pose (device-local only) | Free | Local VIO pose for burst alignment and camera-height estimate. See §0.1 — use ARCore's *device-local* motion tracking only; **never** the Geospatial/VPS endpoints. |
| Camera height | Derived from ARKit/ARCore floor plane + wearer profile | — | Load-bearing for metric scale (§3.5). |
| Novelty / staleness trigger | Server-pushed **H3** cell coverage bitmap | Apache 2.0 | Small service; not in the original spec's layer table but required by it. |
| Scene-change trigger | Perceptual hash + on-device embedding delta | Free | Cheap; runs on the last-capture thumbnail. |

## 2. Layer B — Compression & upload

| Need | Choice | License / cost | Notes |
|---|---|---|---|
| Still encode | Platform **AVIF / WebP** (`AVFoundation`, Android `ImageEncoder`) | Free, hardware | Do not build a codec. |
| Burst encode | Platform **HEVC / AV1** hardware encoder | Free, hardware | Motion-compensated delta encoding on dedicated silicon. |
| Upload | **S3 multipart / resumable** to object storage | ~$0.023/GB-mo | Egress-free ingest; lifecycle-expire raw imagery after fusion. |
| Transfer scheduling | iOS `URLSession` background transfer / Android `WorkManager` | Free | Wi-Fi-only default, battery-aware. |
| Privacy redaction | **EgoBlur** (Meta) — faces + license plates | **Apache 2.0** | Purpose-built for egocentric imagery. Deferred by the spec, but it is free and drops in on-device or at ingest; there is no reason to defer it. Gen 2 available. |

## 3. Layer C — Fusion engine

### 3.1 Anchor reference data (replaces Google)

| Source | License | Cost | Role |
|---|---|---|---|
| **Mapillary API v4** | Imagery **CC BY-SA 4.0**; API free for all uses incl. commercial | Free. Limits: 60k/min entity, 10k/min search, 50k/day tiles | Primary anchor imagery + the only large street-level corpus that is commercially usable. Share-alike applies to *derived imagery*, not to measurements published as a Produced Work — but keep imagery out of the product. |
| **Overture Maps — buildings** | **ODbL** | Free (AWS Open Data) | Building footprints = the anchor features for pose refinement. Reference only (§0.2). |
| **Overture Maps — transportation** | **ODbL** | Free | Road centerlines for rough placement. Reference only. |
| **Overture Maps — places / divisions** | **CDLA-Permissive 2.0** | Free | Permissive; safe to use more freely. |
| **OpenStreetMap / Overpass** | **ODbL** | Free (self-host Overpass for production) | Sidewalk tags, crossings, curb tags where they exist. |
| **Municipal open data** (curb ramp inventories, sidewalk centerlines, ADA transition plans) | Varies, mostly public domain / CC0 | Free | NYC, Portland OR, Bend OR, SF confirmed to publish curb-ramp point inventories. Doubles as ground truth (§6). |
| **TDEI / OpenSidewalks** | Open | Free | 5,600+ validated datasets, 10.5M crossings, ~400k miles of sidewalk. Both a prior and an output schema target. |

### 3.2 Image retrieval / place recognition (cross-contributor association, Step 4)

| Choice | License | Notes |
|---|---|---|
| **MegaLoc** (DINOv2-base + SALAD aggregation) | **[UNVERIFIED]** — confirm weights license | Current SOTA across VPR + landmark retrieval + visual localization (SOTA on LaMAR). First choice. |
| **SALAD** | **[UNVERIFIED]** | Vendored by GLUEMAP; fallback. |
| **FAISS** | MIT | Billion-scale ANN index for the descriptor store. |

### 3.3 Local features & matching (Step 3 + Step 5)

| Choice | License | Verdict |
|---|---|---|
| **LightGlue** (matcher, code + weights) | **Apache 2.0** | Use. |
| **ALIKED** (detector) | **BSD-3-Clause** | Use — pair with LightGlue. |
| **DISK** (detector) | Apache-2.0 **[UNVERIFIED]** | Alternate. |
| **SuperPoint** | **NON-COMMERCIAL** ("academic or non-profit … noncommercial research use only") | **Banned.** Its weights and inference file are the single most common license landmine in this stack — most tutorials pair SuperPoint+LightGlue by default. |
| **SuperGlue** | Non-commercial | **Banned.** |
| **LightGlue-ONNX / ALIKED-ONNX** | Per parent | Official ONNX exports from the COLMAP org — use for serving. |

### 3.4 Structure-from-motion / triangulation (Step 5)

| Choice | License | Status |
|---|---|---|
| **COLMAP** | BSD-3-Clause | Active (last update Aug 2026). The reference implementation. |
| **GLUEMAP** | BSD-3-Clause | **The current choice.** From the COLMAP org; first SfM pipeline to integrate feed-forward reconstruction backbones into a global SfM framework. Stages: retrieval → two-view inference → multi-view inference → global mapping → refinement. Outputs COLMAP sparse reconstructions. Vendors Pi3, SALAD, VGGSfM, Doppelgangers++ — **each vendored model needs its own license audit**; the BSD-3 covers GLUEMAP itself only. |
| **GLOMAP** | BSD-3-Clause | **Deprecated and archived Jan 2026.** Do not start here despite most tutorials pointing at it. |
| **hloc** (Hierarchical-Localization) | Apache 2.0 **[UNVERIFIED]** | Localization harness around retrieval + matching; pairs with GLUEMAP. |

### 3.5 Metric scale — the actual hard problem

The spec never says where metric scale comes from; monocular SfM recovers geometry only up to
an unknown scale factor, and every Tier B number is metric. Published evidence says this is
*the* determining component: UrbanVGGT's ablation found **metric scale calibration was the most
critical component** of the whole pipeline. Four independent scale sources, fused:

| Source | Tooling | License |
|---|---|---|
| **Camera-height calibration** (primary — the UrbanVGGT method) | ARKit/ARCore ground plane + wearer eye height | Free |
| **Metric monocular depth** | **Depth Anything 3 — `DA3METRIC-LARGE`** | Code Apache 2.0; **metric/mono checkpoints Apache 2.0** (the GIANT/LARGE any-view checkpoints are **CC BY-NC 4.0** — do not ship those). Prefer `-1.1` suffixed weights. |
| **Known-dimension objects in frame** | Curb ~6 in, detectable-warning domes 0.9 in dia / 0.2 in high, standard sign faces | — |
| **GPS baseline over a walk** | Phone GNSS | Free — weakest; ~5.5 m mean deviation. |
| Alternate geometry backbone | **VGGT** | Non-commercial **except** the `VGGT-1B-Commercial` checkpoint (application required, same performance). If VGGT is used, it must be that checkpoint. |

### 3.6 Semantics (Step 6)

| Need | Choice | License |
|---|---|---|
| Open-vocabulary segmentation (auto-labeling engine) | **SAM 3** | Custom **SAM License** — commercial use permitted with restrictions (no military/ITAR/nuclear/weapons). Verify against final terms. |
| Concept prompting / detection | Grounding-DINO-class open-vocab detector | **[UNVERIFIED]** per-model |
| Curb ramp detection | Train own, bootstrapped from **RampNet** (CC BY 4.0, 214k panoramas / 850k labels, **0.9236 AP**) | Labels CC BY 4.0 — **but the underlying panoramas are Google Street View (§0.1). Use the method and the label geometry against municipal inventories; do not ingest their imagery.** |
| Sidewalk polygons from aerial | **Tile2Net** (VIDA-NYU) | Open source — segmentation of sidewalk/crosswalk/footpath from sub-meter aerial tiles. Free prior for cells with no ground coverage. |
| OCR (sign text) | **PaddleOCR** / **docTR** | Apache 2.0 |
| Training corpus | **Own, auto-labeled** (see §0.3) | Owned |

### 3.7 Fusion & world model

| Need | Choice | License / cost |
|---|---|---|
| Spatial index | **H3** | Apache 2.0 |
| Geospatial DB | **PostGIS** on managed Postgres | PostGIS GPL-2.0 (server-side use imposes nothing on your product) |
| Columnar analytics / batch | **DuckDB** + **GeoParquet** | MIT / open |
| Versioned world-state | Postgres bitemporal tables (`valid_from`/`valid_to`, `observed_at`) | — |
| Pipeline orchestration | **Prefect** or **Temporal** | Apache 2.0 / MIT |
| Queue | SQS / NATS JetStream | Cheap / Apache 2.0 |
| GPU compute | Spot A10G/L4 for retrieval + depth; on-demand for SfM | Largest single cost line |

## 4. Layer D — Distribution

| Need | Choice | License / cost |
|---|---|---|
| Basemap tiles | **OpenFreeMap** (free hosted, MIT, OSM data) or self-hosted **Protomaps** PMTiles | OpenFreeMap free; **Protomaps commercial use requires GitHub sponsorship** |
| Map rendering | **MapLibre GL JS / Native** | BSD-3 |
| Pedestrian routing | **Valhalla** | MIT — pedestrian costing, and pedestrian-area routing recently merged to the planet build |
| Geocoding | **Nominatim** (self-host) or **Photon** | Open |
| Output schema | **OpenSidewalks schema** + custom facts extension | Open — aligning to it makes municipal/TDEI ingest and export near-free |
| Robot API | OpenAPI + protobuf/gRPC over the facts table | — |
| API gateway / auth | Kong or managed gateway | — |

## 5. Ground-truth checking (built day one, per spec §8.4)

| Source | Use |
|---|---|
| **Project Sidewalk** API — 50+ cities, 10 countries, 3.4M+ contributor labels, CSV/GeoJSON/API | Independent human labels for Tier A precision/recall. License **[UNVERIFIED]** |
| **Municipal curb ramp inventories** (NYC, Portland OR, Bend OR, SF) | Authoritative point ground truth for ramp presence/position |
| **TDEI / OpenSidewalks** validated datasets | Sidewalk centerline + width priors |
| **Calibrated reference walk** — laser distance meter + digital inclinometer + RTK rover | The tape-measure sample the spec calls for. RTK reaches ~5 cm; this is the only way to certify Tier B honestly. |

## 6. Cost posture

Free at any plausible pilot scale: Mapillary, Overture, OSM, municipal data, Project Sidewalk,
TDEI, OpenFreeMap, Valhalla, all model weights listed as permissive, all libraries.

Real costs: **GPU inference** (retrieval embedding + metric depth + segmentation per frame,
then SfM per cell), **object storage** for transient imagery, and **the RTK/laser reference kit**
(one-time, low thousands). No mapping-API line item at all — which is the direct payoff of
ruling out Google in §0.1.
