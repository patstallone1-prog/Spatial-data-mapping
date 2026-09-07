# 19 · Known issues in the reconstruction

Written as a working list. Each entry says what is wrong, where it comes from, and how to tell
whether it is fixed — because most of these are invisible until you stand in the right place,
and several were fixed once already and came back in a different form.

## Fixed in this pass, and how they would look if they regressed

| Was | Symptom | The rule that now prevents it |
|---|---|---|
| Per-segment box ribbons | Loose pavement squares; curves as fans of plates with wedges of ground between | One mitred band per way, `mitredEdges` |
| Aprons aimed at the matched wall | Pale slabs lying across intersections | Anchored on the kerb, aimed off the road; `insideCarriageway` refuses the rest |
| Aprons at half kerb height | Garages with no crossing in front of them | Flush with the footway top, same concrete |
| Footway on both sides always | A strip of pavement down the middle of a divided road | `walk_sides`, dropped where the ground is another street's carriageway |
| Road texture with tiled joints | A floor of grey squares with a lighter edge on each | Uniform grain, no structure at tile scale |
| Broken yellow everywhere | A dotted line down every street including one-ways | Yellow only between opposing traffic; white and broken between same-direction lanes |
| A subset of highway types queried | Whole blocks black where motorway, trunk and link roads should be | Every road class in the Overpass query |

## Open

**Building heights are mostly a default.** 3,536 of 15,984 buildings have no recorded height and
are drawn at 10.5 m. They are desaturated to say so, which is easy to miss from above. OSM is
the only source in play; the city's own records would be better.

**Facade detail is procedural except on 220 walls.** Colour is sampled from photographs on a
growing share of buildings, but the window grid, the material and the storey lines are invented
everywhere except chunk c14r03. A sampled colour on an invented facade is still an invented
facade.

**Crossing style is assumed.** 817 crossings are confirmed continental by the city's inventory.
The rest are drawn continental because that is San Francisco's prevailing standard, not because
anything checked. 598 inventory points match no mapped crossing at all — the two datasets
disagree about where crossings are, and neither has been reconciled to the other.

**Curb heights are ours alone.** No San Francisco record publishes one. 4,926 ways carry a
measured height and the rest fall back to the corridor median, which is a real number standing
in for a specific one.

**The right of way is assumed symmetric.** Every bound derived from it — the footway clip, the
carriageway width where no kerb geometry exists — takes half the recorded width either side of
the centreline. Real streets widen on one side. The footway bound declines rather than guesses
where this would put the kerb within 1.5 m of the property line, but the carriageway does not.

**Intersections are not modelled.** Streets are bands that overlap at their crossings; there is
no junction geometry, no kerb return radius, no corner. It reads acceptably from above and is
plainly wrong at street level.

**Ground inside blocks is a flat neutral.** Back yards, light wells and car parks are not mapped
as anything, and the surface under them says only "not described".

## How to inspect

Anything below shows up in the browser and not in the tests.

```bash
python scripts/build_sf_corridor_3d.py --reuse-osm && python tools/build_pages.py
```

Then open `docs/sf-corridor-3d.html`, use the corner search, and look at street level rather
than from above — the whole class of "something is lying in the road" defects is invisible from
a bird's eye and obvious from six feet up.
