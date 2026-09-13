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

- Deployed curb geometry is decimetre-class because of a 0.10 m simplification and 6-decimal
  quantisation on the way to the page. Serve local metres at full precision.
- Sidewalk width against the city's own survey: 1.16 m MAE with a long tail, against a
  city-vs-city agreement that is much tighter. The tail is where the kerb-derived pavement
  meets a mapped footway on the same side.
- Curb ramps are ingested and drawn; they do not yet move the crossing endpoints to where the
  accessible path actually is.
- A committed near-field (5–10 m) benchmark with per-sample ground truth, so the 13 mm
  curb-height claim rests on a file rather than on a paragraph.

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
OpenStreetMap: carriageways at surveyed widths, footways from the kerb outward with a four-inch
kerb tile that carries SFMTA's curb paint on its own vertices, corners laid as their own piece
between the two pavements that meet there (each pavement cut where the other's outer edge is,
so the corner square is neither missing nor doubled), lane paint that stops at every
junction including the ones OSM does not split at, continental crossings resolved so a junction's
legs match, curb ramps with ADA dome pads, bus zones in transit red, 24,603 official signs facing
the road, 142 stone and brick walls, 75 tunnel bores with portals, 146 surface car parks,
15,984 buildings of which 14,490 carry a colour sampled from a photograph of that building, and
the sky. 705 tests, most of them running the renderer's own rules in Node rather than reading
its source.

**Measured, and measured against something.** Curb heights from lidar; kerb lines from
photographs, checked against that lidar; widths from the city's survey; building heights from
lidar medians over 12,262 footprints.

**Still open.** The anchoring front end (B1) is a correct engine with an empty tank, and that
has not changed. The precision items in B2 are the difference between a map that is right to a
decimetre and one that is right to a centimetre.
