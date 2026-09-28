# Oakland tubes and Central Freeway visual geometry

The Posey Tube (OSM `22272045`) and Webster Street Tube (`25966237`) are immersed
road tubes under the Oakland Estuary. The former carries Oakland-bound traffic and the
latter Alameda-bound traffic. Both are two-lane, one-way routes. Published clearances are
4.47 m (Posey) and 4.52 m (Webster): [Caltrans tube overview, via the cited sources on
Wikipedia](https://en.wikipedia.org/wiki/Posey_and_Webster_Street_tubes). Their OSM
centrelines and portal nodes provide horizontal placement. The visual floor's low point,
12 m below the measured water surface, and its smooth approach curve are **inferred**, not
surveyed bathymetry or a tunnel as-built. The renderer tags this distinction on each tube.
No tunnel depth, collision, or robotics product should be derived from that inferred floor.

The Central Freeway segments in the Mission OSM payload are `bridge=yes` at layers 1 and 2.
They are elevated road decks, with the streets below remaining open. The app now gives the
deck a continuous inferred profile, parapets, and visual piers; its clearance is not measured
and must be replaced if bridge survey/as-built data becomes available. It is not rendered as
an enclosed tunnel.

The Oakland app region extends south to 37.785° so both tubes and their Alameda approaches
are inside its data and terrain bounds. The previous website region remains frozen. The
local benchmark should include fixed cameras at both tubes' Oakland and Alameda mouths,
inside both tubes, and beneath and above the Central Freeway. Approval requires visible
road continuity, no terrain across a portal, separate luminaires and carriageway markings,
and no deck/ground intersection. The benchmark is a **render** check; it cannot validate
inferred vertical dimensions.
