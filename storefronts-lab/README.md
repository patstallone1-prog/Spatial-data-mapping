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
| `models/`, `observations/` | Building models and the photo readings applied to them | yes |
| `models/.history/` | Studio save backups | no |
| `out/rectified/`, `out/stacks/`, `out/snaps/` | Rectified photos, photo-over-render stacks, studio renders (Mapillary CC BY-SA) | no |

The first live sweep takes about 15 minutes, almost all of it the Mapillary tile sweep.
Set `KERBFRONT_OFFLINE=1` to run from the cache only.

## Building models and the studio

A sweep says what a business is (the app's own `shopKinds` rules over its name and category,
its registry licences, Google service flags where the owner already paid for them, outdoor
seating evidence). `kerbfront model` turns one business into an editable building, built the
way Kerbside builds it: the DataSF LiDAR footprint and height, the app's wall materials,
colours, photo-read openings and roof colour, `smc.exteriors` for the storefront band, and the
app's street record for the sidewalk and kerb. Offices and upstairs tenants are drawn as plain
buildings (`business_type.render`); only shops and restaurants get a storefront.

```sh
$PY -m kerbfront model "A16" "Dragon Well"         # models/<id>.json (pipeline + observations)
$PY -m kerbfront more-photos a16 --wall 12 -k 4    # add frames aimed at another wall
$PY -m kerbfront rectify a16 --wall 12 --photos 0 1  # photos re-projected onto the wall, 1 m grid
$PY -m kerbfront align a16 0 --du 0.6 --dz -0.9    # correct a photo's camera along/out/up
$PY -m kerbfront stack a16 --wall 12 --photos 0 1 --snap a16-w12   # rectified photos over the render
$PY -m kerbfront studio                            # http://127.0.0.1:8791/
```

The studio (`studio/`) draws a model with Kerbside's own storefront renderer (vendored,
unchanged, in `studio/kerbside/`) plus the lab's walls, openings, bays, cornices, friezes,
fluted pilasters, ornaments, balconies, awnings, signs (drawn from vector layers, never from
copied artwork), lights, parklets, sidewalk strips, café enclosures, trees, bus shelters,
heaters and neighbours. Every part can be picked in the view or the parts list and edited in
the inspector: material and texture (stucco, smooth render, brick, painted brick, siding,
shiplap, shingle, tile, stone, concrete, metal panel, painted wood, glass), colours, window
and door placement (drag in the elevation, double-click to add), wall cladding bands, glass
colour, awnings, signs and seating. Undo/redo, save (to `models/`, the previous version
kept in `models/.history/`), and four views: street, orbit, photo match (model over the
photo) and compare (side by side). `?view=wall&wall=N` gives a square-on long-lens elevation
framed exactly like `rectify`, and `studio.snap(name)` saves it for `kerbfront stack`.

What the photos say is kept apart from what the pipeline guessed: `observations/<id>.json`
lists dotted model paths, each with the frames it was read from and how, and is reapplied on
every rebuild. `observations/src/<id>.py` writes those files; each reading names its frames.

### Outdoor seating

* **Sidewalk strip** (OSM `outdoor_seating`, Shared Spaces, sidewalk permits): tables and
  chairs against the facade, never deeper than leaves 1.83 m (6 ft) of clear sidewalk.
* **Parklet** (registry `FIXED COMMERCIAL PARKLET` / `PUBLIC PARKLET`): a deck in the parking
  lane from the kerb, 1.83-2 m deep, 6-12 m long, centred on the frontage until a photo says
  otherwise; barrier (planter wall, planks, low wall, rail), benches along the street side,
  tables, and an optional roof (canopy, slats, corrugated) on posts, glass panels or rails.
* **Café enclosure** (`zone: "sidewalk"`): the parklet structure built on the sidewalk against
  the facade, for frontages whose photos show one (Dragon Well).

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
