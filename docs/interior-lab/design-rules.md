# Interior Studio design rules

This is a game editor for inferred interiors, not a building permit or an as-built survey. Source footprints, elevations, windows, exterior doors, stairs, slab openings, measured elements, and marked structural or shared walls stay fixed. Unverified fitted partitions are editable game geometry; their editability does not establish that a real wall is safe to remove.

## Spatial checks

The editor checks usable room dimensions, full room coverage without overlap, furniture containment and collision, floor/table support, door clearance, and connectivity from an exterior entrance through each floor's room graph. Habitable rooms use 6.5 m² and 2.134 m usable width; corridors use 0.9144 m; doors use 0.815 m clear width. Angled corners may taper, but a narrow neck between usable areas fails. Toilets and other service rooms have a game minimum width of 0.75 m, and closets/storage 0.45 m. Narrow necks connecting larger usable areas are screened at 0.75 m before category width checks. This does not certify every path around furniture. These service and bottleneck values are product choices, not quoted building-code requirements.

Rooms can be split along either plan axis or merged across an editable partition, including connected angled and L-shaped polygons. Disconnected splits, holes, blocked entrances, unsupported furniture, and edits to another apartment are rejected. Existing source problems are displayed as original-plan issues; they still need repair before applying. A draft can remain invalid while being edited.

## References and scope

California's [2025 Title 24 cycle](https://www.dgs.ca.gov/-/media/Divisions/BSC/06-News/Information-Bulletins/2025/BSC-Bulletin-25-01-FINAL.pdf) became effective January 1, 2026. The editor does not claim complete compliance with that cycle, local amendments, accessibility requirements, seismic design, fire separation, ventilation, daylight, plumbing or electrical rules.

The [San Francisco 2025 DALP manual](https://media.api.sf.gov/documents/DALP_Manual_-_2025.pdf) specifies a 70-square-foot, 7-foot minimum horizontal dimension for a bedroom in that program. The [HCD dwelling interpretation](https://www.hcd.ca.gov/sites/default/files/docs/building-standards/ib-2016-06.pdf) is a historical reference for similar dimensional concepts and bathroom facilities. Neither is a complete current code for every residence.

The [2010 ADA Standards](https://www.ada.gov/law-and-regs/design-standards/2010-stds/) provide the 32-inch door and 36-inch accessible-route references used for game-wide clearances. ADA applicability varies; these values do not certify a private home as accessible.

## Saving and applying

Practice houses cannot modify world homes. Open an owned home's **Customize interior** button in Kerbside's Homes panel to establish a world/account/home-scoped session. Review validates the complete edited plan. Applying submits an ownership-checked world command and rebuilds both the visible interior and collision geometry. Designs persist with the solo world or the party host's world snapshot. The editor reports a pending state until the world acknowledges the command; a closed world will receive the pending design when reopened on the same browser origin.

An apartment must have a reliable interior-unit link. Ambiguous apartment boundaries are blocked rather than editing neighbors. Other units and shared halls remain intact. Furniture assets retain their existing library attribution and licensing metadata. Download design saves a draft backup, including invalid work; it is not an approved construction drawing.
