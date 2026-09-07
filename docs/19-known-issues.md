# 19 · Known issues in the reconstruction

Written as work instructions. Each entry says what is wrong, where the code is, how to
reproduce it, and what "fixed" looks like. Ordered by how much of the model each one spoils.

Nothing here is speculative — every item was seen in the running page.

## How to reproduce anything in this list

```bash
python scripts/build_sf_corridor_3d.py --reuse-osm && python tools/build_pages.py
```

Then open `docs/sf-corridor-3d.html` and use the corner search. **Bust the browser cache with a
query string** (`?v=2`); the service worker is network-first for documents and data but the
browser is not, and two rounds of surface work were once judged against a stale render.

---

## 1 · Driveway aprons still land in the wrong place

**Where** `apronSlab()` in `scripts/build_sf_corridor_3d.py`.

**What happens** A pale slab appears detached from any garage, sometimes in the middle of an
intersection. It is the ramp over the footway, drawn at the curb-cut point and pointed at the
wall the garage was matched to.

**Why** The cut and the wall come from different datasets. SFMTA gives the cut a position along
a block face; the wall comes from an OpenStreetMap footprint. Where the match picked a side
elevation or a building across a yard, the ramp is laid on a guess.

Aprons whose wall faces more than about 57 degrees away from the cut are now dropped rather
than drawn, which removes the worst of them and leaves those garages with no ramp.

**Done when** Every apron touches its own garage, and a garage with no confident apron has none
rather than a misplaced one. Consider deriving the direction from the *street* the cut belongs
to — the cut carries `STREET_CNN`, and a ramp is always perpendicular to the kerb.

## 2 · Footways do not join at corners

**Where** the derived-footway block in the ways loop, and `trimWay()`.

**What happens** Two footways meeting at a corner leave a notch, because each is trimmed back
from the intersection and nothing turns the corner between them.

**Why** Trimming was the fix for footways running out across the carriageway. It solved that and
left the corner empty.

**Done when** A kerb turns the corner. The right shape is a fillet — an arc of the kerb radius
between the two trimmed ends — which needs the corner position and the two bearings, all of
which are already known where two street ways share an endpoint.

## 3 · Crossings are drawn continental everywhere

**Where** the `isCrossing` branch of the ways loop.

**What happens** Every marked crossing gets ladder bars.

**Why** SFMTA's continental inventory confirms 817 of 2,517, and 598 of its points sit near no
mapped crossing at all — the two datasets disagree about where a crossing *is*, which is not
evidence that the rest are plain. Continental is the prevailing standard, so it is the default.

**Done when** The match is good enough to trust the negative. The inventory carries
`STREETNAME` and `CROSS_STRE`; matching on those against the two streets at the crossing's
nearest intersection would be far stronger than the 20 m proximity test doing the work now.

## 4 · Lane counts are OpenStreetMap's, unchecked

**Where** `_int_text` extraction in `fetch_osm`, lane dividers in the ways loop.

**What happens** 1,232 roadways carry two or more lanes and get white broken dividers spaced
evenly across the carriageway. Even spacing is an assumption: a parking lane is not a traffic
lane and is not the same width.

**Done when** Lane widths come from something. SFMTA's `MTA.CTA_trafficlanes` has AM, off-peak
and PM counts for 2,272 segments in this corridor and is already reachable through
`smc.official.sfmta`; it is from a 2010 travel model, so it belongs beside the OSM count as a
second opinion rather than replacing it. Imagery is the third: `semantics-000.parquet` will
carry a road fraction per frame once the run finishes.

## 5 · Building heights are a default on 3,536 buildings

**Where** `_building_height()`.

**What happens** Roughly a fifth of buildings are 10.5 m because OpenStreetMap has neither a
height nor a level count. They are drawn desaturated to say so.

**Done when** Something measures them. The aerial lidar that produced the kerb heights covers
these roofs; a height above the ground plane per footprint is the same kind of query.

## 6 · Colours are sampled for a tenth of the buildings

**Where** `scripts/build_building_colours.py`.

**What happens** Buildings take their colour from photographs of themselves where the sampler
has reached, and from a table of San Francisco's building stock everywhere else.

**Done when** The pass finishes. It is running and resumable; `build/building-colours/` holds
the checkpoints and re-running skips what is done.

## 7 · The build does not check the Javascript it emits

**Where** `scripts/build_sf_corridor_3d.py` writes a large HTML file containing a large script.

**What happens** A text edit that deletes or duplicates a declaration produces a page that
throws on load and renders nothing, and the build reports success.

This has now cost two debugging sessions: once when an edit removed eighteen declarations
including `buildingMesh`, and once when an old `ribbon` left in place quietly overrode its
replacement.

**Done when** The build parses its own output and fails loudly. A syntax check plus an
assertion that no top-level name is declared twice would have caught both.

## 8 · Overpass failures fall back silently

**Where** `fetch_osm()`.

**What happens** *Fixed this pass, recorded because it hid a real bug for two builds.* A 504
from Overpass raised, the build aborted, and the previous artifact stayed in place — so a
classification change appeared to do nothing. There are now three mirrors and three attempts.

**Watch for** The same shape of failure anywhere a cache backs a network fetch.

## 9 · Twelve payload fields nothing reads

**Where** the payload written by `build_payload`.

`accepted_on`, `centroid`, `cnn`, `cnn_name`, `colour_views`, `continental`, `crosswalk_year`,
`kerb_n`, `kerb_sigma_m`, `road_source`, `road_varies_m`, `row_m`.

These are provenance and are kept deliberately — an inspector panel that says where a number
came from is the natural next feature. They are listed so nobody mistakes them for live inputs.

## 10 · No per-feature inspection in the viewer

**What happens** The map shows the geometry and the sidebar summarises it, but clicking a kerb
or a footway says nothing about where its numbers came from.

**Done when** Clicking a surface shows the recorded width, the sheet it was read from, the
measured value and the difference — every one of which is already in the payload (see item 9).
