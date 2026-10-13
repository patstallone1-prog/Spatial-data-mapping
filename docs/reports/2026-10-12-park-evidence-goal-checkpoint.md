# Parks, paths and wiring — completion report (12 October 2026)

This closes the pass the Codex checkpoint opened (RPD evidence, the hybrid path resolver and
the GRIP connector): parks now carry their play areas, furniture and buildings; paths their
material; and wires are drawn only where a photograph sees them.

## Parks

- **Areas from OpenStreetMap and RPD** (`smc.parks.areas`): playgrounds, fitness areas, picnic
  areas, dog areas, community gardens and skateparks, with age bands (2–5, 5–12) and sand play
  from the RPD facility pages. Corridor: 41 playgrounds, 5 fitness, 7 picnic, 6 dog, 3 garden;
  Mission 28 playgrounds and a skatepark; Sunset 26; San Jose 18 and 8 dog areas; Oakland 26.
- **A generic playground** fills each one to its shape: the area's minimum rectangle is packed
  with equipment for its age band (tower with slide, tot structure, swings, dome climber,
  spinner, seesaw, spring riders, sandpit, playhouse, balance beam) in a seeded order, so no
  two are alike; equipment OpenStreetMap maps is kept and packed around; the count scales
  with area (4–16, a second main structure above 900 m²). Rubber safety surface under it,
  grass kept off it.
- **Fence with a real entrance**: a picket fence round each playground, with a gap and a gate
  swung inward where OpenStreetMap maps the gate, else where a path crosses the boundary,
  else at the nearest path within 30 m, else the longest side (Mission: 57 gates, 13 by the
  last fallback).
- **Park buildings are not houses**: a restroom has a slab roof overhang, its two doors with
  signs, a louvre band and a drinking fountain; a maintenance shed a ribbed roll-up door and a
  personnel door; a container its corrugations. None takes a house's windows or entry logic.
- Benches, picnic tables, garden beds and fitness stations fill their areas.

## Paths — the hybrid resolver, wired in

Order of evidence: RPD functional-area paths (asphalt, concrete, dirt, decomposed granite;
0.95) → OpenStreetMap `surface` (0.85) → automated photographs (Mapillary's segmentation
looking along the path: 0.78 from two sequences, 0.60 from one) → landscape context (≤0.45).
A way changes material where the evidence does (split at each transition).

Landscape context is gated by the kind of way, after Berkeley's campus footways came out as
mud: a trail (path, track, bridleway) can be mud within 10 m of a stream or in a wetland,
earth in woodland, scrub or an RPD natural area, sand within 40 m of a beach. A park footway
takes only beach or woodland context; steps, sidewalks and promenades never take any.

Photographs read 191 corridor paths (2,277 paved readings, 7 ground), San Jose 105, Haight 49,
Oakland 32, Berkeley 32, Sunset 31, Mission 23, Palo Alto 19. Only paths whose material
differs from footway concrete are restyled on the page; the rest keep the pavement look.

Presidio Wall Playground lies outside every region's bounds, so its beach-sand context is in
the resolver but not on any page yet.

## Wiring — evidence-backed spans

1. PG&E GRIP LineDetail (`scripts/ingest_pge_grip.py`, local only, gitignored) gives the
   circuit network. Palo Alto is skipped: its utility is CPAU, not PG&E.
2. Observed poles (Mapillary and OSM) are merged within 6 m, matched to the network within a
   tolerance calibrated against a shifted-network null (7–9 m), and walked along the network
   to their neighbours: 12–95 m spans, network distance ≤ 1.25 × straight + 6 m; spans across
   a feeder or section boundary or with ambiguous membership are flagged.
3. Each candidate is projected into up to four photographs' segmentation (wire vs sky) beside
   a sham span turned 90°; a photograph first registers itself on a detected pole within 7°.
   Open sky where the wire must be counts against a span only in registered views. A mapped
   underground cable vetoes it.
4. Drawn: two independent sequences (0.95; 0.88 flagged) or one (0.90). Network-only
   candidates (0.75) are kept in the audit file and not drawn. Telecom spans (wire in the
   4.4–6.9 m band, none higher) get one cable at about 6 m.

| Region | Detections → poles | Tolerance | Drawn (power / telecom) | Open sky | Underground |
|---|---|---|---|---|---|
| Corridor | 13,329 → 7,810 | 8 m | 272 (191 / 81) | 44 | 3 |
| Haight | 1,645 → 1,285 | 8 m | 151 (130 / 21) | 3 | — |
| Mission | 5,193 → 3,888 | 7 m | 754 (706 / 48) | 6 | 8 |
| Sunset | 9,653 → 6,642 | 9 m | 684 (519 / 165) | 16 | — |
| San Jose | 9,932 → 6,837 | 8 m | 237 (183 / 54) | 14 | — |
| Oakland | 674 → 531 | 8 m | 24 (14 / 10) | — | 2 |
| Berkeley | 566 → 469 | 8 m | 1 | — | — |

Berkeley is thin: few photographs there look up at its poles.

**Rights.** PG&E's portal claims ownership of derivatives and limits use to its planning
purposes; leave to redistribute has been asked for, not given. So nothing of PG&E's is
published: the sidecars carry only Kerbside's poles, the photo verdict and its confidence.
Phase count, voltage and feeder stay local (`build/electrical/`) and ship only with
`--publish-grip-attributes`; without them a span hangs one primary and its neutral, not an
invented three-phase crossarm. The spans themselves were proposed by walking GRIP's network,
then confirmed by photographs; if PG&E objects even to that, the electrical sidecars are the
only files to withdraw.

## Not done

- Facility-page and capital-project evidence covers two parks; the rest have none yet.
- Presidio Wall (above). Berkeley's wiring (above).
- The audit files (`build/park-evidence/`, `build/electrical/`) are local, not served.

## Checks

Full suite passed (1,528 tests, one skipped), blocking lint, `node --check` on the module,
the template-sync test after the page rebuild, and the Mission app world in a browser
(28 playgrounds, 132 pieces, 57 gates; parks and electrical sidecars loaded).

Sources: [RPD Facilities](https://data.sf.gov/api/views/ib5c-xgwu.json),
[RPD Functional Areas](https://data.sf.gov/api/views/38b7-6db3.json),
[PG&E GRIP](https://grip.pge.com/), Mapillary (CC BY-SA 4.0), © OpenStreetMap contributors.
