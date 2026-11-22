# 59 · Street trees from the city's survey, one pavement, and one shop front

Reworks that leave one version of each thing in the world, where two had been drawn over
each other.

## Street trees

### Where a tree stands

The trees come from the city's own survey: DataSF's Street Tree Inventory (tkzw-k3nq).

- **Records left out.** Stumps, vacant records and planting sites are dropped.
- **Snapping to the curb.** Each cutout tree is snapped to the DataSF curb lines (emxt-b6yg).
  Medians are matched to the ISLANDS polygons.
- **Survey tiles.** The build tool `tools/build_sf_tree_survey.py` writes the trees to
  `docs/sf-tree-survey/`, tiled by 0.01°.
- **Replacing the older sources.** In the page (module 18) the survey replaces the inventory's
  trees inside San Francisco. The lidar's canopy trees (yards, parks) are kept only where no
  surveyed tree stands within 4 m. Daly City's inventory trees, south of 37.708°, are kept as
  well.

Sidewalk openings follow the Public Works / Better Streets rules (`docs/sf-tree-placement.mjs`
`sidewalkPlot`, and module 18):

- **Opening:** 18 in back from the curb face. The opening is the recorded plot (2×4 ft to 5×5 ft;
  3×3 ft when none is recorded). It is narrowed to 3 ft, then 2 ft, where that is needed to keep
  a 4 ft clear path behind it.
- **Spacing:** 15 ft at least between trees (`treeCrowding`).
- **Junctions and stop signs:** 25 ft from a junction's corner and from a stop sign.
- **Crosswalks and fire escapes:** 10 ft from a crosswalk and from a fire escape.
- **Driveways and hydrants:** 5 ft from a driveway and from a hydrant.
- **Signs and meters:** 3 ft from a parking, no-parking or loading sign and from a parking meter.
- **Clearance table.** These distances are `TREE_OBSTACLE_CLEARANCE_M`, the same table as the
  tool's `CLEARANCE_M`.
- **Obstacle sources:**
  - stop signs: SFMTA 4542-gpa3;
  - meters: SFMTA 8vzz-qzz9;
  - signs: the SFMTA sign shop's assets in the corridor's street furniture;
  - hydrants: OpenStreetMap `emergency=fire_hydrant`, which does not map every hydrant.

  No public layer gives sewer laterals or utility meters, so those clearances cannot be checked.
- **Trees in the road:** a tree in a carriageway is drawn only on a surveyed island, and never in
  a junction's box.

### Every surveyed tree has a real opening, unless it stands on grass

The tree is there, whatever the rules say, so a surveyed tree is never left standing in bare
concrete.

- **Sliding to keep the distances.** Where a curb-side opening breaks one of the distances above,
  it is slid along the walk one or two whole squares (3 or 6 ft) either way, to the first place
  where every distance holds. The tree goes with it; the survey's own position is good to about
  that.
- **Cut where it stands.** Where no slide clears the distances, the opening is cut where the tree
  stands. Only an opening in a junction's box, in the water or across a driveway is refused.
- **Other trees in paving.** A tree with no curb-side opening of its own (a property-side cutout,
  a tree the survey places on the walk) is given one of the walk's own squares, 3 ft, square to
  the walk, where it stands in paving.
- **On grass, none.** A tree on grass (a park, a lawn, a yard: no paving under it) has no opening,
  and neither do the lidar's canopy trees, which are the yards' and the parks'.
- **Counts.** `window.kerbsideTreeSquares` gives `slid`, `asSurveyed`, `squareOpening` and
  `onGrass`.

### The opening is one of the walk's squares

Each opening is first laid as part of the sidewalk, then becomes the dirt the tree stands in.

- **The squares.** The sidewalk is scored in 3 ft squares along the walk, counted in each walk's
  own UVs (module 09).
- **Waiting for the walks.** The ground build waits for the walks (`streetSurfacesLaid`, marked
  in module 19) and reads which square the opening falls in (`walkSquareAt`).
- **Sliding and stretching.** The opening slides along the walk, at most half a square, onto
  whole squares (`walkSquarePlot`). It then stretches to fill them: one square for a 3 ft
  opening, two for a 4 to 6 ft one. The tree moves with it, to the opening's centre.
- **Cutting and filling.** Module 19 cuts the walk's triangles out under the opening, and the
  pit is laid in that hole.
- **Where squares can't be read.** If the walk's squares can't be read there, the opening stays
  where the survey puts it. This happens off a scored walk, or where the walks did not arrive
  within a minute.
- **Counts.** `window.kerbsideTreeSquares` counts both cases.

### Two tiers of every tree

- **Far.** Every tree is an instance of its kind (`treeVariant(kind, "far")`): its bark, its big
  limbs and two in three of its leaf cards, each a little larger. It is drawn at the tree's
  measured height and spread, and a tree with a measured crown faces north, as its crown does.
  There is one mesh per kind and part for the whole window, cut at walls by `cutTreeAtWalls`.
- **Near (module 17 `treeNear`).** The closest 60 trees within 70 m of you are each drawn on
  their own, in place of their instance:
  - **Leaf cards:** every card of the kind (`treeVariant(kind, "near")`), drawn from the same
    random sequence, so the far tree is the near one with a third of its cards left out.
  - **Measured crowns:** where the 2023 USGS 3DEP lidar measured the tree, its crown is shaped to
    the measured one (`shapeCrown`). In eight wedges round the trunk it takes the crown's reach,
    its lowest branches and its top, with the trunk at its measured girth.
  - **Shared materials:** a near tree uses the far kind's materials, so it is cut at walls and
    moves in the wind the same way.
  - **Building and keeping:** three near trees are built a step. Up to 140 are kept for coming
    back; then the oldest are let go. From higher than 400 m up only the far tier is drawn.
  - **Counts:** `window.kerbsideTreeNear` gives the counts.

  The headset draws the far tier only.

### The measured crowns

The 2023 lidar is an EPT octree (CA_SanFrancisco_1_B23). It keeps a share of the points at each
depth, so a crown at full density is the union of every depth's nodes over it.

- **What the first pass missed.** It read one node per tree, which gave 253 crowns.
- **Reprofiling.** `build_sf_tree_survey.py reprofile` takes every node, at every depth, near the
  trees in a box. With `--fetch`, it reads each node the cache does not have from the public USGS
  bucket and deletes it once its points are taken.
- **Building each crown.** Each tree takes points from half way to the next tree, at most 8 m.
  The ground is its class 2 points; the crown is classes 1, 3, 4 and 5. A crown needs 70
  multiple-return points over 1.5 m, and points in each of the eight wedges.
- **What is still modelled.** Branches are not traced. A near tree's limbs are its kind's limbs,
  bent to the measured envelope.

Rebuild a district's crowns, then its obstacles:

```
python tools/build_sf_tree_survey.py reprofile docs/sf-tree-survey <CA_SanFrancisco_1_B23> \
  --box=-122.4478,37.7983,-122.4310,37.8082 --fetch --scratch <tmp>
python tools/build_sf_tree_survey.py obstacles docs/sf-tree-survey \
  --signs docs/sf-corridor-furniture.json --hydrants <sf-hydrants.json>
```

## One pavement: the walk's three-foot squares everywhere

Under and beside the walk there was a second pavement: the paving laid on a lot (a forecourt, a
plaza, the paving fill inferred from the aerial photographs, a front path). It used the walk's own
concrete, but its UVs were metres over 8, so its joints made two-metre squares, square to the map
rather than to the street. Where it showed between the walk and a house front, it read as an older
five-foot pavement under the walk's three-foot squares.

- **One scoring.** Every ground ring drawn with the sidewalk's map (`ringGeometry` with `slabs`) is
  now scored in the walk's three-foot squares (`WALK_UV_M`, four squares a repeat), square to the
  ring's longest side. That is its frontage, so its joints run with the street, in the same phase
  as the frontage fill that carries the walk on to the house fronts (module 16).
- **The rest of the concrete.** The paved islands (module 16) and concrete footways (module 05)
  are scored in the same three-foot squares; they had been metre squares.
- **To the lip.** The walk itself is laid from the curb's 6 in lip (`KERB_LIP_M`) out to the
  property line, and the frontage fill carries it on to the house fronts.

## One shop front

A shop had two fronts:

- **The exterior engine's** (`storefront-renderer.mjs`): the right awning and lettering, but
  showing only the address.
- **The older simple sign:** the business's name.

They were drawn over each other and flickered between the two.

How it works now:

- **One front.** The exterior engine's front is the only one drawn. Its sign carries the
  business's true name.
- **Where the name comes from.** `storeExteriorFor` (module 00) merges the verified tenant names
  (`shops`, `tenant_names`) onto a plan's sign when the plan has no name, or only the address or a
  number. A sign the plan sourced itself (`source_record`, `asset`) keeps its own text.
- **Fallback.** The address stays as the sign where no name is known.
- **The old flow is deleted.** The old awning-and-board flow (`addShopfronts`, `AWNING_MIX`) is
  gone. On a designed front, the living city draws nothing over the engine's front: no trade
  sign and no second window display.
- **A player's business.** The business's own sign replaces the mapped sign while it is shown
  (`_showMappedSign`).
- **Shops without a plan.** The trade storefronts (module 11) and the city's name boards are drawn
  only where a building has no exterior plan.
- **Doors.** The entry door is a glass leaf in a frame (module 24); the wood-block leaves are
  gone. On a designed front the engine's own door is the one seen.

## People walking

The crowd's walk was the soldier model's own march, its arms swung stiff from the shoulder with
the elbows locked; the ways of walking only scaled that swing. Now (`docs/city/npc-figures.mjs`
`swingArms`) each arm is a pendulum on the stride:

- **Timing.** It swings against its own side's leg, 0.38 rad (about 6% of the stride) after it,
  since the arm is carried by the step. The stride's start and the body's left are read from the
  walk itself.
- **Shape.** The upper arm swings a little further back than forward. The elbow is always a little
  bent (0.22 rad) and bends further on the forward swing, later again (it follows through). The
  arm comes in toward the body as it comes forward, and the wrist trails the swing.
- **The chest** turns a little with the arms, against the hips.
- **Styles.** Brisk, easy and sway walkers swing wider or narrower on the same pendulum.
- **A new walk: hands in pockets** (`WalkPockets`). Both hands in the front pockets, carried by
  the hips, the elbows out and back, the shoulders a little hunched. Only someone whose legs have
  pockets walks this way.
