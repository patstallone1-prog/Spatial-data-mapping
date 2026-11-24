# Storefront lab (`kerbfront`)

This is a standalone companion to Kerbside's exterior engine. It aims to get the most
accurate business exteriors and layouts in San Francisco, starting with the Marina. It
gathers every public record about each storefront, finds the street photos that actually
show that storefront's frontage, and hands a provenance-tagged program to `smc.exteriors`.

It lives outside the main system:

* it does not import `smc`, and nothing in `src/` or `docs/` imports it;
* its tests have their own `pytest.ini`, so the main suite never collects them;
* it reads the main checkout's `data/` (Overture parquet, Mapillary catalogue, `.env.local`
  for `MAPILLARY_TOKEN`) and never writes there.

The full plan, from raw photos to recognisable buildings, is in [PLAN.md](PLAN.md).
Measured results are in [reports/](reports/).

## Run

From `storefronts-lab/`, using the main checkout's virtualenv:

```sh
PY=../.venv/bin/python            # or the main checkout's .venv from a worktree
$PY -m kerbfront sweep  --area marina-union                       # records + faces (~10 s cached)
$PY -m kerbfront photos --area marina-union --corridor chestnut   # stage 1 geometric filter
$PY -m kerbfront pixels --area marina-union --corridor chestnut --limit 40   # stage 2 + sheets
$PY -m kerbfront handoff --area marina-union --corridor chestnut  # smc.exteriors programs
$PY -m pytest -q                                                  # offline tests
```

Areas are `marina` and `marina-union`. Corridors are `chestnut`, `lombard`, `union`,
`fillmore`, `steiner`, `scott` and `divisadero`.

| Path | Contents | Committed? |
|---|---|---|
| `.cache/` | Raw API responses with URL and retrieval time; thumbnails | no |
| `out/<area>/` | Run outputs | no |
| `reports/` | Summary reports | yes |

The first live sweep takes about 15 minutes, almost all of it the Mapillary tile sweep.
Set `KERBFRONT_OFFLINE=1` to run from the cache only.

## Outputs (`out/<area>/`)

| File | What |
|---|---|
| `businesses.json` | One record per business. Every field is `{value, confidence, sources[], conflicts[]}`. Also holds the address, position, building, face and tenant span, permits, planning records, outdoor seating and storefront likelihood with its evidence. |
| `buildings.json` | Per footprint: LiDAR height, OSM and Overture matches (IoU), parcel, assessor roll, historic status, land use, and permit/planning counts |
| `faces.json` | Every footprint edge, with its role (`street`/`open`/`party`), street, normal bearing and length |
| `photos_<corridor>.json` | Stage 1: per storefront, candidate counts, reject reasons, shot list (`sign`, `elevation`, `oblique-left`, `oblique-right`, extras) and near-misses |
| `pixels_<corridor>.json` | Stage 2: per frame, occlusion, building consistency, sign visibility, sharpness, exposure and verdict |
| `crops/`, `sheets/` | Face crops and contact sheets for review. Mapillary CC BY-SA, not committed. |
| `exterior_programs_<corridor>.json` | docs/30 input contract plus a `kerbfront` block |

## Credentials

* **Mapillary:** `MAPILLARY_TOKEN`, from the environment or the main checkout's `.env.local`.
* **Google Street View:** deliberately unavailable. `config.secret` refuses
  `GOOGLE_MAPS_API_KEY` unless `KERBFRONT_ALLOW_GOOGLE=1` is set, because using it needs
  the owner's go-ahead (see PLAN §5 on its terms).

## Licences

* Mapillary imagery: CC BY-SA 4.0, © Mapillary contributors.
* OSM: ODbL, © OpenStreetMap contributors.
* Overture: CDLA-Permissive-2.0, per row.
* DataSF: PDDL / open.

No imagery or bulk OSM-derived data is committed.
