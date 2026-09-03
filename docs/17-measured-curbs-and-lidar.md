# 17 · Measured kerbs, and where the lidar actually is

Until this pass every kerb height in the catalogue was the same number. `DEFAULT_CURB_HEIGHT_M`
is six inches, written into 4,410 curb rows because six inches is what a kerb usually is, and
flagged `default_curb_height` and `requires_metric_depth_for_measurement` so nobody would mistake
it for an observation. `exact_curb_heights_available` was `false`.

It is now `true`, for a small and honestly-bounded set of places.

## KartaView has no lidar

This was the first thing to check and it did not survive checking. Three independent tests:

**Every device is a phone or a dashcam.** Across all 61,977 KartaView frames in the corridor:

| device | frames |
|---|---|
| LGE LG-H815 (LG G4) | 33,952 |
| LGE LGUS991 (LG G4) | 17,152 |
| Waylens dashcam | 2,565 |
| iPhone 7 Plus / 6S Plus / 7 / 5C / 6 Plus / X / 6S | 3,914 |
| Samsung, HTC | 2,394 |

The newest is `iPhone10,3` — an iPhone X, from 2017. Apple did not put lidar in a phone until the
iPhone 12 Pro in 2020, and even then KartaView's app never recorded it.

**The sequence payload has no depth surface.** `/2.0/sequence/{id}` returns 45 fields. The only
one that sounds like a sensor is `obdInfo`, which is on-board diagnostics — vehicle speed off the
engine bus. `hasRawData` refers to the source video. The storage layout offers three renditions
of a JPEG and a text file of phone sensor logs.

There is nothing to find. This is not a hard extraction; the data does not exist.

## What does cover these blocks

Aerial lidar does, and it is in the public domain. USGS 3DEP flew San Francisco and put the
result in a free AWS bucket as an Entwine octree: `CA_SanFrancisco_1_B23`, **13.09 billion
points**, covering the corridor with room to spare. No registration, no licence to accept.

Measured over the corridor, ground returns arrive at **20–77 points per square metre**, median
about 53 — roughly 14 cm spacing. That is dense enough to fit a road plane and a footway plane
either side of a kerb line.

### One trap worth naming

The tree is stored in EPSG:3857. Web Mercator's horizontal unit is not a metre: it is a metre
divided by the cosine of the latitude. Z, meanwhile, is a true orthometric metre. At San
Francisco's latitude the two differ by **27%**. Mixing them yields kerb heights that look
plausible and footway widths that are wrong by a quarter — the kind of error that survives
review because nothing about the output looks broken. Everything leaving `smc.lidar.ept` is
converted to a local east/north/up frame in true metres.

## What it took to get a true number

The first run reported a kerb of **9,061 mm**. The cause was a reasonable-sounding decision made
without evidence: keep ASPRS class 1 as well as class 2, on the theory that a near-vertical kerb
face is the sort of thing a ground classifier declines to label. In this collection class 1 holds
three quarters of the points and is dominated by building walls and street trees. It handed the
plane splitter a facade, and a facade wins every time — it is flat, well sampled, and nine metres
tall.

Ground returns only. Then the second problem appeared: kerbs of 0 mm and 42 mm, where a San
Francisco kerb is about 152 mm. Profiling one footway across a 14 m strip showed why — the
surface fell smoothly from 28.14 m to 27.79 m with **no discontinuity anywhere**. There was no
kerb in that data to find, and `split_kerb_planes` had dutifully returned two halves of the same
cambered road.

That is the real limit of the sensor. A kerb face is a 150 mm vertical strip seen from an
aircraft almost directly above, so whether it registers depends on the scan geometry over that
particular metre of street. Sometimes it does. Often it does not.

So detection now comes before fitting. `find_kerb_line` bins ground returns laterally at 25 cm,
takes a median per bin, and looks for a rise that clears both an absolute floor of 60 mm and
three times the local surface roughness — measured per bin as a scaled median absolute deviation,
not assumed. Only if a step survives that is its offset handed to `measure_cross_section` as
`kerb_offset_hint`, which the implemented plan already accepted for exactly this purpose.

Fitting first and asking questions afterwards always produces two planes and therefore always
produces a height. The question of whether there is a kerb at all has to be settled before
anything is fitted.

### Validation

Fourteen footways, chosen at random from those 25–70 m long:

```
footways with a kerb:  6 / 14
kerb slices:           32
median height:         118 mm     p25 85    p75 182
footway width:         4.8 m median
```

Eight of fourteen footways report nothing at all, and per your instruction they keep their
existing `needs_depth` status rather than receiving a number the data cannot support.

The spread is worth reading honestly. The median sits close to the six inches a San Francisco
kerb is nominally built to, and the quartiles span the range real kerbs occupy — worn kerbs and
driveway aprons run low, older granite runs tall. But it is a broad distribution, and this is
one sensor at one look angle: it is a first measurement, not a settled one. `measure_cross_section`
flags `surfaces_not_parallel` where the two planes disagree, which is what a driveway apron or a
ramp looks like from above, and those flags travel with the row.

An earlier, stricter version of the detector returned 4 of 14 footways and 7 slices, every one
inside 100–200 mm. It looked better and was worse: it estimated surface roughness from the two
bins either side of the candidate riser, and those bins straddle the kerb and contain both
surfaces by construction. Their spread is about half the step height, so the test divided the
signal by itself. Tightening a threshold until only the easy cases survive is not precision.

The error budget changed too. `MeasurementConfig.scale_relative_sigma` exists because a
photogrammetric reconstruction does not know its own scale. A ranging sensor does, so for lidar
it is set to zero and the sigma is the scatter of the two plane fits and nothing else — about
±28 mm, measured rather than assumed.

## Waymo

Waymo drove these streets with five lidars and five cameras and labelled every point, including
`road` and `sidewalk` classes directly. Ground-level, so a kerb is seen side-on rather than from
the one angle that makes a 150 mm riser nearly invisible. It is the better sensor for this job.

The project has now accepted a non-commercial footing, and Waymo is in.

The licence is worth restating because it is inherited rather than merely accepted: the Waymo
Open Dataset permits "research, teaching, scientific publication and personal experimentation",
and the restriction covers derivative intellectual property. A curb model trained on this data is
itself non-commercial, permanently, and anyone given that model has to be given the licence with
it. That is the trade being made.

### What Waymo can and cannot do here

It cannot anchor a block. Poses in the v2 release are expressed in a frame local to each segment
and no absolute georeference is published — the most specific location fact in the dataset is the
string `location_sf`. So these points cannot be placed on the corridor map, and Waymo adds no
rows to it.

What it does is better than anchoring for the question actually in front of us. It sees a kerb
side-on from about a metre and a half up, with per-point semantic labels that name `TYPE_CURB`,
`TYPE_ROAD` and `TYPE_SIDEWALK` directly. That is the measurement the aerial pass can only make
where the scan geometry happens to cooperate. Waymo's job here is to **calibrate and check the
aerial pass** — to establish what the distribution of real San Francisco kerb heights is, and
whether 118 mm seen from above is right.

### What is written, and what is not

`smc.lidar.waymo` reads the v2 release, which is Parquet rather than v1's TFRecord, so it needs
pyarrow and not TensorFlow. Access checking and San Francisco segment selection are written:
`sf_segments()` filters the whole split on the `stats` component before anything heavy is
fetched.

None of it has been executed against the live bucket, because the bucket cannot be reached from
here, and that is stated rather than implied. Two steps are acts of consent a person makes under
their own account:

```bash
gcloud auth login
gcloud auth application-default login
```

and registration at <https://waymo.com/open/> under that same account, accepting the terms at
<https://waymo.com/open/terms/>. `scripts/ingest_waymo_sf.py` reports which of those is missing.

## Mapillary

Also in, and the reason it was ever out is worth being precise about, because it was never the
licence. Mapillary imagery is CC BY-SA 4.0 — the same share-alike terms as Panoramax. What kept
it guarded was platform risk: it needs an account, cannot be self-hosted, and is operated by a
company that also sells wearable cameras, which is to say by a potential competitor whose terms
could change under a product depending on them.

Competitive exposure is a commercial worry. A non-commercial project does not have it, so the
guard is gone. `smc.imagery.mapillary` is a full catalogue provider on the same interface as the
other two — `iter_region_observations` over a bounding box, cursor-paged, splitting a box only
when it comes back full with no cursor.

Two fields there needed care. `computed_geometry` is Mapillary's structure-from-motion position
and is normally better than the raw GPS in `geometry`; it is preferred where present, and which
was used is recorded per observation as `mapillary:sfm` or `mapillary:gps` rather than being
silently mixed. And `captured_at` is milliseconds since the epoch — reading it as seconds puts
every frame in 1970, so that is pinned by a test.

It needs a token in `MAPILLARY_TOKEN`, made at
<https://www.mapillary.com/dashboard/developers>. Without one the harvest raises a setup error
naming the variable rather than failing mid-run.

## Storage

No new repository is needed. The lidar cache reached 590 MB during this run and will pass several
gigabytes over the full corridor, but it lives in `build/`, which is gitignored — it is a cache of
a public bucket, reproducible at any time and not worth versioning. What is kept is the
measurement journal, one JSON line per slice, which will end at a couple of thousand lines.

The question is worth revisiting when Kerbside's own captured pixels grow; the release-shard
planner in `smc.storage.release_shards` already exists for that. It is not this data.

## Reproducing

```bash
.venv/bin/python scripts/measure_curbs_lidar.py          # resumable; hours for the full corridor
.venv/bin/python scripts/build_cv_depth_store.py --catalog data/sf_corridor
```

The journal records every footway attempted, including those where no kerb resolved. That matters
for the same reason the rest of this does: a footway missing from the measured set because the
sensor could not see its kerb has to be distinguishable from one nobody has looked at yet.
