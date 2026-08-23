# Status — 2026-08-20

> **Superseded on 2026-08-23 by `docs/09-production-review.md`.** Parts B1 and B2 below are
> out of date: measurement extraction, the street overlay and real feature matching have since
> been built. Kept for the credential list in Part A, which is still current.

191 tests, lint clean, four commits. Run `python -m smc.adapters check` for a live version of
Part A.

---

## Part A — Credentials to obtain

### A1. Required. Nothing runs without these four.

| Variable | Service | Credential type | Where |
|---|---|---|---|
| `MAPILLARY_ACCESS_TOKEN` | Mapillary API v4 | **OAuth app token** | mapillary.com/dashboard/developers → register an application. Free for all uses including commercial. 60k/min entity, 50k/day tiles |
| `HUGGINGFACE_TOKEN` | Hugging Face Hub | **Access token** | huggingface.co/settings/tokens → read scope. Pulls DA3METRIC-LARGE, SAM 3, MegaLoc, ALIKED, LightGlue |
| `SMC_DATABASE_URL` | Postgres + PostGIS | **Connection string** — no signup if self-hosted | `postgresql://user:pass@host:5432/smc`. Cloud SQL, Supabase, or local |
| `SMC_OBJECT_STORE_URL` | GCS or S3 | **Bucket URL** — signup only if not already on a cloud | `gs://bucket` or `s3://bucket` |

**One extra, not an env var:** `VGGT-1B-Commercial` on Hugging Face needs a **separate access
application** (LLaMA-style approval form). Only needed if VGGT is used as the geometry backbone;
GLUEMAP's vendored Pi3 may cover it. Worth applying now since approval takes time.

### A2. Optional — Google. Free, and internal-build-only by your decision.

| Variable | Service | Credential type | Notes |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Maps Platform (Street View Static, Geocoding, Elevation, Tiles) | **API key** | $200/mo credit. Console → APIs & Services → Credentials |
| `GOOGLE_ARCORE_API_KEY` | ARCore Geospatial VPS | **API key** | Free. 1,000 sessions/min. Solves anchoring outright, in 87+ countries |
| `GOOGLE_CLOUD_PROJECT` | GCS, Pub/Sub, Cloud SQL, Vertex AI | **Project ID** + `gcloud auth application-default login` | Commercial-safe (infrastructure, not Maps content) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account | **JSON key file path** | IAM → Service Accounts → Keys |

### A3. Optional — other

| Variable | Service | Credential type |
|---|---|---|
| `META_WEARABLES_APP_ID` | Meta Wearables DAT | **App ID** — needs a Meta Managed Account at developers.meta.com/wearables |
| `MAPTILER_API_KEY` | MapTiler basemap | **API key**. Only if OpenFreeMap is not enough |

### A4. Settings, not credentials — no account anywhere

`SMC_ANCHOR_INDEX_URL`, `OVERTURE_S3_REGION`, `PROJECT_SIDEWALK_BASE_URL`, `RTK2GO_MOUNTPOINT`,
`VERTEX_AI_LOCATION`. Values, not secrets. `RTK2GO_MOUNTPOINT` needs you to browse rtk2go.com
and pick a base station within 35–50 km of where you drive.

### A5. Wired in and needing nothing at all

Six services, live now, no key, no account: **Overpass** (OSM sidewalk/kerb/crossing tags),
**Nominatim** (geocoding, 1 req/s enforced in-client), **Project Sidewalk** (3.4M human
accessibility labels across 50+ cities), **Overture Maps** (building footprints via DuckDB over
public HTTPS — no AWS account), **OpenFreeMap** (unlimited vector tiles), **RTK2go** (free RTK
corrections, 800+ base stations, no rover registration).

**So the actual shopping list is four accounts, plus one Google project if you want the Google
stack, plus one Meta account if you want the glasses target.**

---

## Part B — Features still needing code

Ordered by whether they block the critical path.

### B1. Blocking — the learned front end of anchoring

The anchoring *geometry* is built and tested: DLT + Huber Gauss-Newton under RANSAC recovers
pose to 2.2 mm / 0.0075° with 35% outliers, with a covariance so a pose carries its own sigma.
What it consumes does not exist yet:

1. **Descriptor extraction** — load MegaLoc, embed frames, populate `DescriptorIndex`. Weights
   licence **[UNVERIFIED]**; confirm before it goes in.
2. **Feature matching** — ALIKED (BSD-3) + LightGlue (Apache-2.0) inference producing the
   `FeatureMatcher` protocol's mutual matches. Do not let a tutorial substitute SuperPoint.
3. **⚠️ Reference-index bootstrapping.** *This is the real gap.* Anchoring works by matching
   against frames that are **already anchored** — so where does the first one come from? Three
   candidate answers, none implemented, and the choice is architectural:
   - the **RTK vehicle rig** surveys the corridor and its frames seed the index (cleanest, and
     the reason the Tier 2 rig exists);
   - Mapillary's own SfM poses seed it (fast, inherits their error);
   - batch SfM over a pass, georeferenced by GPS in aggregate (no extra hardware, weakest).

   Until this is decided and built, the anchoring pipeline is a correct engine with an empty
   fuel tank.

### B2. Blocking — measurement extraction

**Nothing yet turns a reconstruction into a curb height.** Pose and scale are solved; the step
between them and a `WorldFact` — fit the ground plane, find the kerb line, measure the rise,
measure width perpendicular to the path, classify the surface — is unwritten. This is the module
that actually produces the product, and it is currently a hole between two finished pieces.

### B3. Blocking — SfM integration

GLUEMAP (BSD-3, COLMAP org) driven per cell-cluster, emitting the sparse reconstruction the
measurement step consumes. Note GLOMAP is archived; do not start from tutorials that use it.
Each vendored backbone (Pi3, SALAD, VGGSfM, Doppelgangers++) needs its own licence audit.

### B4. Semantics

- Curb-ramp detector, bootstrapped RampNet-style from municipal coordinates (their method
  reached 0.9236 AP). Use the method, not their Street View panoramas.
- Segmentation for sidewalk / surface / obstruction. **No permissively licensed street-scene
  dataset exists** — Cityscapes, Vistas, and Synscapes are all non-commercial — so this means
  auto-labelling own and Mapillary imagery with SAM 3 and human-QA'ing it. That labelled corpus
  is a build item and arguably a second moat.
- OCR (PaddleOCR/docTR) for sign text.

### B5. Device and simulator bindings

- **Meta DAT binding** — `WearablesCameraSource.start()` raises. Needs the real toolkit wiring.
- **Mock Device Kit binding** — same, plus the FFmpeg transcode step on Android.
- **CARLA Unreal asset import** — the OBJ generates and verifies; loading it into CARLA needs a
  source build and a content package. `render_drive()` raises rather than pretending.
- **EgoBlur** on-device redaction (Apache 2.0, drop-in).

### B6. Server and product

- Ingest service, upload endpoint, object-store lifecycle (expire raw imagery after fusion).
- PostGIS schema + migrations for `WorldFact` (the model exists; the DDL does not).
- **Ground-truth checker service** — the comparison logic against Project Sidewalk / municipal
  / RTK truth. The types are built (`GroundTruthFact` scores numeric and categorical
  separately); the service that runs it on every pipeline release is not.
- Coverage service serving the H3 staleness bitmap the novelty trigger needs.
- Pipeline orchestration (Prefect/Temporal), spot-GPU workers, replay.
- Robot API, consumer app, OpenSidewalks/TDEI export.
- HTTP transport for the Mapillary and Street View adapters (request builders are done and
  tested; `fetch` is deliberately one unwritten function).

---

## Where this stands

**Built: the parts that are hard to get right and easy to get subtly wrong.** The geometry
solver, the scale fusion, the confidence model, the sampling model, and the schema invariants
are done and tested — 191 tests, and they assert properties rather than fixtures. Several of
them caught real errors during the build: a clock-based capture trigger that produced
untriangulatable 0.35 m baselines, a stereo baseline too narrow to reach the kerb, a haversine
with a directional bias, a `visual_positioning` capability with no commercial-safe provider.

**Not built: the parts that are mostly integration, plus two that are not.** B5 and B6 are
substantial but well-understood work against known interfaces. B1's bootstrapping question and
B2's measurement extraction are different — they are unresolved design, not pending typing.

**The honest position.** This is a credible engine core with no fuel and no output stage. A
frame cannot yet be anchored, because the index is empty and nothing fills it; and if it could
be, nothing would turn the result into a curb height. Both gaps are squarely on the critical
path named in `03-build-order.md`, and neither is a surprise.

**What has genuinely de-risked** since the research phase: the vehicle rig can carry an RTK
antenna and a rigid stereo baseline, which closes both critical-path risks *for the roadway
vantage* — 0.96% scale uncertainty holding ±0.15 m out to 15.6 m. That also answers B1: the rig
is the bootstrapping mechanism. Glasses reach 6.2 m on camera-height scale alone, which is fine
for the footway vantage a wearer actually occupies and not fine for anything across a lane. The
division of labour between the two capture modes is now a measured result rather than a guess.

**What has not.** Whether learned retrieval and matching hold up on real repetitive streetscapes
at 5 m GPS error is still the open question, and it is still the thing that decides the product.
Everything built so far assumes that step works; none of it proves it does.

**Next.** B1.3 first — decide and build the bootstrapping path, because B1.1 and B1.2 have
nothing to match against until it exists. Then B2, since it is the only thing standing between a
working reconstruction and a sellable fact.
