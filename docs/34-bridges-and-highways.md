# 34 · Bridges and highways: structures you stand on

A bridge or a freeway deck is a **structure**, not paint on the ground. The world now knows
what each one is, a person can walk onto it, along it and off it, and a viaduct overhead is
walked under rather than stood on.

## What the world knows about a deck

Every elevated road is registered as it is built, in one grid (`registerElevatedSegment`). The
bay's bridges are registered by `buildBayBridges`, and a region's own bridge and ramp ways by
`registerElevatedWay`. Each segment carries what it is:

| Field | Meaning |
|---|---|
| `kind` | `"bridge"` or `"highway"` |
| `name` | the bridge's or the freeway's name (Golden Gate Bridge, Dwight D. Eisenhower Highway, Central Freeway) |
| `reach` | the half-width a person can stand on: the roadway and its walkways |
| `walkway`, `walkTop` | where the walkway starts and how far it stands above the road (the bay bridges) |
| `paved` | a street drawn on its lift, whose pavements are the city's own |

`elevatedDecksAt(x, z)` returns every deck over a point, with its height. `structuresAt(x, z)`
asks the same of the region drawn beside the page, so the app answers wherever the deck was built.

**Bridge or highway.** The payload carries no road class, so the rule works from what it does
carry (`structureKindOf`):

- A freeway's name (`Freeway`, `Highway`, `Expressway`, `Skyway`, `Interstate`, `Parkway`,
  `I-`, `US`, `CA`, `SR`) is a highway.
- So is a deck stacked over another deck, OSM `layer` 2 and up, which is an interchange.
- An unnamed deck chained end to end to a highway deck is that highway's ramp
  (`highwayRampWays`, a walk through shared end nodes).
- Anything else carried over the ground or water is a bridge.

## Where a person stands

`walkerGroundInfo` stands on the highest deck no more than a step (0.6 m) above the feet. That
gives three behaviours:

- **Up a ramp:** each step is within reach of the next.
- **Under a viaduct:** a deck 8 m overhead is out of reach, so the street is the ground.
- **On a flyover:** the deck below is stood over, not on.

A jump has no feet height. A jump from search or the map onto a span over the water lands on
the deck, not in the water under it. A clicked deck lands where it was clicked.

Measured in the app (headless Chrome, `kerbside.structuresAt` and `moveWalker`):

| Test | Result |
|---|---|
| Golden Gate, jump to mid-span | stands on the deck at 65.5 m, `bridge`, "Golden Gate Bridge" |
| Golden Gate, walk 1 km north from mid-span | stays on the deck all the way: 65.5 → 65.9 → 59.9 m toward the north tower |
| Bay Bridge west span | both decks registered, upper 56.2 m and lower 45.7 m; a jump lands on the upper |
| Mission, 16 deck ways | 14 classify as `highway` (2 are level with the street at their abutments, so they are the street) |
| Mission, 12 decks with room under them | a walker under each stays on the street (12/12) |
| James Lick Freeway ramp | walked from the street (0 m) onto the ramp (4.5 m), then the deck (6 m) |

These are the unit tests' cases too: `tests/test_walkable_decks.py` runs the page's own functions.

## Still open

- No deck was found at the probe points for the Bay Bridge east span or the Richmond–San Rafael
  Bridge. Either the probe points miss them, or they are not built in the app's perimeter.
- The Golden Gate's deck stands at 65.5 m at mid-span. The real roadway is about 75 m (67 m of
  navigation clearance under a 7.6 m truss), so the profile is roughly 9 m low.
- Parapets and railings are drawn, but do not yet stop the walker at the deck's edge.
- Highway decks are flat ribbons on a lift: no girders, no piers between levels, no
  superelevation. See the plan below.

## The Mission's stacked freeways: what they look like now

The Central Freeway / US-101 interchange near 13th Street and the Cesar Chavez interchange (the
"Hairball") are both in the Mission region, with OSM layers 1 to 3. Today:

- Each deck is lifted to a height by its layer, then blended down to the street at its ends.
- Where two decks cross at different layers, they are drawn at nearly the same height and
  z-fight from a distance.
- Ramps meet at grade rather than stacking.
- The Central Freeway's columns are visible; the stacked connectors have none.

## Plan: highways that loop over each other on several levels

The goal is a highway system that looks right and is walkable at every level, built from data
we can get, not drawn by hand.

**1. A graph of decks, not lifted ribbons.** Build each interchange as a graph of OSM ways:
`motorway`, `trunk` and their `_link` ramps, joined at shared nodes. Each edge has a start node,
an end node and a height profile along it. A ramp is an edge between a freeway node and a
street node, so heights are continuous across it by construction.

**2. Heights from measurement first.**
- Deck heights come from the USGS 3DEP lidar point cloud: first returns over the deck footprint
  minus the bare-earth DEM. The points of the topmost structure at each spot give the deck
  surface. Where decks stack, the returns separate into levels by height clusters (the upper
  deck masks the lower one from above).
- Lower decks hidden under upper ones take their height from where they emerge at either side,
  interpolated under the overlap.
- With no lidar, OSM `layer` orders the levels and Caltrans' standard vertical clearance
  over a freeway (16.5 ft, about 5.0 m, plus the deck depth) sets the minimum gap between them.

**3. Profiles that obey road design.**
- Fit each edge's height along its length as a smooth curve.
- Keep the grade under the design limit: about 8% on ramps and 6% on mainlines.
- Keep vertical curves, not kinks.
- Pin the heights at shared nodes so connectors meet their parents exactly.
- Require at least one clearance between any two edges that cross in plan, and solve the levels
  together when one doesn't (a small least-squares problem per interchange).

**4. Structure that reads as a structure.**
- Extrude each deck as a box girder of its width and depth, with parapets on both edges.
- Bank curves into superelevation.
- Add piers at roughly 30 to 45 m spacing, standing on the terrain, or on the deck below where
  one passes under.
- Put abutments where a deck meets the ground.
- Draw the underside, so a deck seen from the street below is a ceiling, not a missing face.

**5. Every level walkable, and drivable later.**
- Register each edge's profile in the deck grid with its `kind`, `name` and `layer`.
- The walker's step rule already picks the right level; parapets become wall segments in
  `wallSegmentsNear`, so the edge stops you.
- A vehicle follows the same graph: routing uses the edges and the profile gives height.

**6. Checks before it ships.**
- Per interchange: every crossing pair keeps its clearance.
- Every ramp's ends meet their parents within 5 cm.
- No grade exceeds its limit.
- Screenshots from fixed viewpoints at the Hairball and the Central Freeway, compared against
  aerial imagery for plan position, and against Street View-style ground photos (looked at, not
  stored) for levels and pier spacing.

**Order of work:** the graph and the shared-node heights, then the lidar deck heights for the
two Mission interchanges, then girders and piers, then parapet collision. After that, the
other freeway stacks: the MacArthur Maze, the 101/280 junction, and the I-80 approach to the
Bay Bridge.
