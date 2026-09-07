# 18 · The city's own records, and what every photograph is worth

Two shifts happened in this phase, and they point in opposite directions.

The first is that images stopped being responsible for rediscovering geometry San Francisco had
already surveyed. The second is that the images got substantially more valuable anyway, because
each of them stopped being a dot on a map and became a frame standing at a known place on a
known street looking at a known cross-section.

## What the city publishes, and what it does not

DataSF's tidy extracts are not the whole picture. SFMTA exposes the working GIS underneath
them, and for street geometry that is a different class of data.

| Layer | Count in the corridor | What it gives |
|---|---|---|
| `MTA.curbs` | 9,004 polylines | The kerbs themselves, against 1,044 in DataSF's basemap extract |
| `MTA.BSM_streetwidths` | 15,059 rows citywide | Right of way in feet and inches, with the filename of the sheet |
| `MTA.CTA_trafficlanes` | 2,272 | AM, off-peak and PM lane counts, from a 2010 travel model |
| `MTA.continentalcrosswalks` | 1,415 points | Which crossings are ladders, and the year each was installed |
| `MTA.oneway_streets` | 784 | Which streets have no centreline to draw |
| Parcels, right-of-way polygons, sidewalk widths | thousands | Property lines and a 2014 footway survey |

**No curb heights.** Nothing in San Francisco's open data publishes one. Top-of-curb and
flow-line elevations exist only on scanned improvement plans behind a viewer with no bulk
interface, so the curb height in the model stays ours, from aerial lidar. The schema has room
for the scanned path and the extractor has a `georeferenced_scan` method it does not yet use.

## The joins are the hard part

Two surprises, both of which would have produced confident wrong answers:

**12,076 of 12,190 right-of-way records carry no CNN.** The obvious key is absent from almost
every row. They are keyed instead by the street and the two cross streets it runs between,
sorted rather than left in the order each table happened to list them — one table runs a block
Drumm to Davis and the other runs it Davis to Drumm.

**56% of curb lines carry no side-of-street.** The side is derived geometrically instead, from
which hand of the centreline the line falls on. Island kerbs are excluded outright: pairing one
against a block face measures the distance to the median, which is a real number and not the
width of the street.

## Measuring a street rather than assuming it

The width now comes from the distance between the two mapped kerbs, sampled every two metres.
Of 1,477 profiles, **555 vary by more than a metre along their own block** — bulb-outs and
turning pockets that no single number could hold.

341 profiles are declined rather than used, for varying more than one street plausibly can or
for having too few stations to trust a median. Macondray Lane came out as a 7.9 m carriageway
varying by 17.5 m, which is the profile reading the kerbs of the street it crosses.

The corrections that matter are not on the main streets. Clay Street's Chinatown blocks were
already about right. The alleys were not:

| | measured between kerbs | previously drawn |
|---|---|---|
| Spofford St | 3.2 m | 6.9 m |
| Brooklyn Pl | 3.7 m | 6.1 m |
| Waverly Pl | 5.1 m | 12.9 m |

## Three sources, and whose fault the difference is

Two sources that disagree tell you one of them is wrong. Three tell you which.

- City survey vs city record: **MAE 5 cm**, median error zero, 98% within half a metre.
- Our bounded lidar vs either: **MAE 0.86–0.93 m**.

So the disagreement is ours. One caveat worth keeping: two records agreeing that closely may
share a lineage rather than corroborate each other.

## Every frame gets a place

A sidecar keyed by `observation_uid`, rebuilt from the catalogue and the official geometry in
about two minutes. It is a sidecar and not new columns because all of it is derived and none of
it should be mistaken for something a provider said.

- **368,035 of 386,624** placed on a street with a station and a side.
- **323,086** ordered by capture time within their sequence, because Mapillary supplies no frame
  index for any of its 307,986 rows — and without an order there are no neighbours, no
  baselines and no multi-view anything.
- **339,011** have a partner with a parallax in the band that fixes a depth; **129,332** have one
  from a different provider; **215,266** have one more than five years apart.

The measure for geometry is not how far apart two cameras are. It is the angle they subtend at
what they are both looking at — two metres apart is excellent for a shopfront and useless for a
tower, and it is the same pair either way. PandaSet's lidar was used to check that assumption
against measurement rather than leaving it asserted.

## Reading a point cloud without letting it run

PandaSet ships its sweeps as gzipped pandas pickles, and unpickling is not parsing: the format's
`GLOBAL` opcode imports whatever name the file asks for and `REDUCE` then calls it.

The file is read under two gates. A static scan walks the opcode stream without constructing
anything and collects every global the file will import; a sweep from this archive asks for
nine, all numpy and pandas reconstruction primitives plus the builtin `slice`. The unpickler
then refuses anything outside the same list, and substitutes a recording stub for the pandas
classes so that no pandas code runs on the bytes at all.

Building the static scan surfaced its own bug. The first version ignored `STACK_GLOBAL` — the
opcode every pickle written this decade uses, which carries no argument and takes its operands
from the stack — and so reported a clean bill of health for every modern payload. A test that
tries to smuggle `__import__` past it now runs at four protocol versions.

This is a bounded risk and not an absent one. A whitelisted constructor with a dangerous
`__reduce__` would still get through; none of these has one that is known to be exploitable.
That is why the whitelist is nine names long rather than a module prefix.
