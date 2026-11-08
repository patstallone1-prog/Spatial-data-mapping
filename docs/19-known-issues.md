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
| Exterior edits in a streamed region | Tapping "+ Window" changed the editor's diagram but not the wall; a saved edit never appeared in the world | The editor works in the region's own frame (`exteriorEditorContextFor`); regions draw the verified edits too |
| Bridges drawn but not walkable | A jump to the Golden Gate landed in the water; walkers stood on the street under every deck | Decks registered with their kind and name; the walker stands on the deck within a step of the feet (`walkerGroundInfo`) |
| Scrub drawn as trees | The Marin Headlands were tall eucalyptus on bare ground, and bare past 300 m | NLCD class bounds on the tree canopy; a shrub layer past the near plants (`COVER_STATS`) |
| Editor recolouring the wall | Opening the editor turned 1535 Francisco's wall pale beige (53/255 lighter than the world drew it) before anything changed; a new window could land on the one at 3.2 m | The skin takes the world's finish and cladding (`exteriorWallMaterial`, `BUILDING_WALL_LOOK`), opening on the drawn colour (`drawnWallColour`): 1.5/255 now. `freeSpot` clears openings in height as well as along the wall |
| Stacked interchanges flat | The Mission's layer 2 and 3 connectors lay on the street; crossing decks drew at one height | `solveDeckLevels`: a level (6.6 m) between crossing decks, grades held exactly; parapets stop the walker on the deck underfoot (`deckEdgeSegmentsNear`) |
| Orbit view inside houses | Turning the view round a house in a streamed region swung the camera through the neighbour's wall into its rooms (only the page's own footprints were checked, and only to jump overhead) | `orbitBlockedAt`: the camera stops short of the first building on the line from what it looks at, the region's (`buildingTopAt`) or the page's, with room to either side and the near plane brought in; within 300 m only. 0 of 144 views round 1535 Francisco inside a building |
| Editor tools off screen | On a tall narrow house the wall's drawing filled the panel, so Window, Door, stairs and undo were below the screen | An Add palette above a capped drawing (`PALETTE`, `svg.elev`); undo/redo in the header |
| Editor saves changing the world at once | Start over removed the saved edit there and then; an editor key had to be pasted | A draft until **Confirm changes**; Start over and Discard change only the draft; closing asks first. Accounts register themselves per device and are verified on the backend (`kerbside_register_device`) |
| Freezes and a crash while editing | Every change kept its materials and a copy of the cladding texture; the still rendered the whole city; the desktop page ran to 3-4.5 GiB of heap | The preview's materials and cut textures are freed with it; the still's far plane is the block; a desktop memory governor trims the caches over 2.6 GiB (`DESKTOP_MEMORY`, `kerbsideMemory()`) |
| Buildings buried on a slope | The Oxford Research Unit at Walnut and Delaware (five metres of fall) stood with its roof under the uphill pavement: its lidar height is over the median ground at its foot, but it was drawn up from its lowest corner | Drawn taller by the difference, sampled as the measure is (`groundRiseFor`, capped at 12 m); the camera and the picker meet the drawn roof |
| Grey slab over car parks | An unbuilt parcel's grey paving fallback, a few millimetres over the ground, fought the car park mapped on it: the Oxford Tract lot was a slab with its asphalt and stalls breaking through in blotches | The fallback is drawn first after the terrain without a depth test, under imagery's fills, yards and lots (`neutral_ground`, renderOrder -1.6) |
| Orbit spun up off the ground | A drag down past the lowest pitch tilted the view up to the sky, and on a hill the camera went under the street | The drag stops at the lowest pitch and at the ground (`ORBIT_GROUND_CLEAR_M`); no tilt |
| Jagged grey trim along kerbs | The waterworks gutter pan was laid every 2 m a few millimetres over the ground; the road, cut on the terrain grid, crossed it on a hill and left it in sharp pieces along the kerb (Walnut Street) | A vertex a metre, `GUTTER_LIFT_M` (3 cm) over the road; its drains, aprons and wet lines on the pan |
| Ground over water | Round Lake Merritt the park's green, mapped over the lake, lay in the water's own plane and the two took turns; from afar the tiles' lawn covered the whole lake | `dropTrianglesOverWater`: a park's, a yard's or a lot's triangles wholly on the water are left out once cut to the terrain (not a plaza or walk: a pier's deck is one); `overWaterAt` asks the nature atlas past the region's own grid; far lawns over water are cut to 8 m pieces and the wet ones dropped (`dryLawnPieces`) |
| Streets dipping into lakes | A street along a shore crossed raster cells called water and dropped to the water's height for a cell or two | `streetOverWaterAt`: a street on a wet cell within three cells of dry ground stands at that ground's height; further out it is a bridge on its own deck |
| Trees in the water | City trees whose recorded point fell on a lake or the bay were planted in it | `overWaterAt` in the tree filter (the nature trees already skipped water) |
| Far sheets taking turns | Zoomed out, the tile lawns, roads, pavements and paint (centimetres apart, log depth, no polygon offset) flashed through each other | `tileDepthBias`: each sheet is drawn a step nearer the eye than the one below it |
| Orbit shoved under awnings | Zooming in to a shop pulled the camera in against its wall, into the dark between the shopfront and the pavement, metres off the walker | `placeCamera` first lifts the view over the roof at the distance asked, up to nearly overhead (`ORBIT_RISE_MAX_PITCH` 1.52); only a wall the walker stands against pulls it in |
| Search gave directions | A place typed in the top search drew a route | The top search takes the walker there and pins it; directions only from the to/from bar |

## Still open

| What | Seen | Where it comes from |
|---|---|---|
| Dark road shapes while a region loads | Blue-grey road sheets and dark terrain wedges along the I-880 approaches by Lake Merritt for the seconds before the detailed streets arrive | The far tiles' coarse road sheets over the coarse terrain; they go when the region is drawn in full |
