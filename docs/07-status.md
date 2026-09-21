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
| `MAPILLARY_ACCESS_TOKEN` | Mapillary API v4 | **OAuth app token** | mapillary.com/dashboard/developers → register an application. Experimental/non-commercial use in this project; API limits apply |
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

## Part B — What is still open

Pruned on 2026-09-13. Items that have since been built are gone from this list rather than
ticked: the tests are the record of what exists, and a list of finished things is not a status.
Items that are now so far down in the code that they cannot fail on their own -- the schema
invariants, the geometry solver, the confidence model -- are gone for the same reason.

### B1. Anchoring — the learned front end

The geometry is built and tested: DLT + Huber Gauss-Newton under RANSAC, pose with its own
sigma. What feeds it still is not. `providers.build_visual_positioning` raises on purpose and
says so. Three pieces, and the third decides the shape of the other two:

1. Descriptor extraction (MegaLoc; weights licence still **[UNVERIFIED]**).
2. Feature matching (ALIKED + LightGlue).
3. **Reference-index bootstrapping.** Anchoring matches against frames that are already
   anchored, so something has to seed the index. The RTK vehicle rig is the answer this project
   has settled on -- 0.96% scale uncertainty holding ±0.15 m to 15.6 m -- and it is not built.

### B2. Measurement — closing the last gaps

Measurement from photographs exists and is validated: plane-sweep stereo with semi-global
aggregation puts the swept ground flat to 25 mm rms, and the kerb-line finder against the
city's lidar agrees to within the lidar's own resolution (`21-curb-measurement-from-photographs.md`).
What remains is precision and provenance, not existence:

- Curb geometry is now delivered at 7 decimals (1 cm) with a 2 cm simplification; the
  decimetre quantisation is gone. The page's assets can be served from another origin
  (`<meta name="kerbside-assets">`, `tools/build_pages.py --assets-base`, `tools/publish_assets.sh`
  for an R2 bucket with credentials in `.env.local`); the split is built and not yet switched on.
- Sidewalk width against the city's own survey: 1.24 m MAE, median error -3 cm, on 6,141
  footways, against a survey-vs-record agreement of 5 cm. The lidar reads the paved sidewalk
  from the kerb riser outward (`smc.lidar.curb.walk_run`) and stops at trees, stairs and cars;
  the survey records the legal width to the property line. The 0.35 m target was not met and
  cannot be against that record; a paved-width reference does not exist to measure against.
- Curb ramps move the crossings: 86.9% of crossing ends stand at a corner where the
  inventory has a ramp, and 90.5% of crossings end on the kerb the model drew (was 59%).
- The near-field (5–10 m) photo-vs-lidar benchmark was run (`data/curb_measurement/
  photo_vs_lidar_run.json`): twelve footways, no paired kerb measurement. The 13 mm claim was
  simulated and is withdrawn; the plane sweep does not yet recover a kerb at five metres from
  real Mapillary sequences, and that is the open problem, not the file.

### B3. Semantics

Segmentation for sidewalk / surface / obstruction still has no permissively licensed
street-scene corpus; the plan remains SAM 3 auto-labelling with human QA. Curb ramps and sign
text no longer need a detector or OCR in this corridor -- both come from SFMTA's inventories --
but a corridor without those inventories will.

### B4. Device and simulator bindings

Unchanged: Meta DAT, Mock Device Kit + FFmpeg transcode, CARLA asset import, EgoBlur on-device.

### B5. Server and product

Unchanged: ingest service, PostGIS DDL, the ground-truth checker as a service, H3 staleness,
orchestration, consumer app, OpenSidewalks/TDEI export, HTTP transport for the imagery adapters.

---

## Where this stands

**Built and deployed.** A 3D recreation of the corridor from the city's own records and
OpenStreetMap: carriageways drawn between the city's kerb lines read along each way (1,651 of
1,755 ways; median error against those lines 4 cm; divided halves against the outer kerb and
the lidar's median, 7 cm), footways from the kerb outward and held to
the building line, a four-inch kerb tile that carries the city's curb paint on its own vertices
(12,499 policy zones that are paint, 4,275 Color Curb Program assets, all five colours),
corners laid as their own piece between the two pavements that meet there, every street as
measured cross-sections (53,771 stations; 78% resolved, 1.7% refused and painted with
nothing) from which the lane paint, the double yellow, the arrows and the bike lanes are
drawn, crossings painted kerb to kerb in legs that part at medians and refuge islands
(99.8% of legs end on a drawn carriageway; 90.5% of crossings end on the drawn kerb and 86.9% of their ends at a corner with a recorded ramp; none displaced by a sidewalk's stand-in), curb ramps with ADA dome pads, bus zones in transit red, 24,603 official signs
facing the road, 142 stone and brick walls, two road tunnels with mouths and cover read from
the lidar, each bore swept from mouth to mouth under the hill with walkways and lights
so the walker can go through, the ground itself a 2 m terrain grid from the lidar (held-out RMSE 0.125 m overall, 0.037 m on the roadway, on top of the lidar's own ~0.10 m) that every street, pavement, building and tree stands on (a third `tunnel=yes` road, 1st Street, is an underpass and drawn
as a street), 146
surface car parks with angled bays, 15,985 buildings of which 14,490 carry a colour sampled
from a photograph of that building, and the sky -- built a frame at a time with its progress on
screen, in tiles the GPU can cull, the fine surfaces dropped past the distance they stop covering
a pixel, at a resolution set by the measured frame time (M4, 2048x1536: 813 draw calls, 11 M
triangles, 6 ms a frame; had been 3,900 calls, 27.6 M triangles, 22 ms, after a half-minute
freeze). 792 tests, most of them running the
renderer's own rules in Node rather than reading its source, and one (`test_width_vs_kerb.py`)
holding the corridor-wide comparison with the city's kerbs to a baseline that may only improve.

**The shore.** The water surface is measured from the lidar's returns off it and the grid is
flooded from the map's coastlines (wet side read from the returns); the page draws the sea at
that surface. No building in the corridor stands on water (tested against the built grid).

**Regions.** Eight built and published beside the corridor (regions/<name>/, a switcher in the
page); Oakland truthful on kerbs, kerb heights, roof heights and terrain from the lidar, its
kerb readings filtered for outliers and smoothed along the way. Not yet for any region outside
San Francisco: ground cover and trees (the parcel pipeline is the city's), building colours,
parking, curb ramps.

**Measured, and measured against something.** Curb heights from lidar; kerb lines from
photographs, checked against that lidar; widths from the city's survey; building heights from
lidar medians over 12,262 footprints.

**Still open.** The anchoring front end (B1) is a correct engine with an empty tank, and that
has not changed. The precision items in B2 are the difference between a map that is right to a
decimetre and one that is right to a centimetre.
