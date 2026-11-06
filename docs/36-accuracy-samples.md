# 36 · Accuracy samples across regions (2026-11-06)

Samples taken in the app (`docs/app-model.html`, headless Chrome at noon), to test whether
things are where they really are, and whether they look like what is really there. Each sample
says how it was measured, so it can be taken again.

## Spatial: are buildings and streets where they really are?

**Method.** Jump to the region and wait until its detail window is attached. Take up to 80
buildings evenly through the window, cast a ray straight down at each building's true OSM
centroid through the page-to-region transform, and record what it hits. For streets, take each
named street's midpoint and ask the region which street is there (`streetNameAt`).

| Region | Buildings hit at their own centroid | Streets named correctly |
|---|---|---|
| Mission | 80 / 80 | 37 / 37 |
| Sunset | 80 / 80 | — (no named street inside the window) |
| Haight–Castro | 80 / 80 | 36 / 37 |
| Downtown Oakland | 78 / 80 (2 hit nothing) | 55 / 56 |
| Downtown Berkeley | 31 / 34 (3 hit nothing) | 54 / 59 |
| Marina corridor | 77 / 80 (3 hit nothing) | 23 / 27 |

No ray hit a *different* building. A miss is a ray that hit nothing: a courtyard building, or
an L shape whose centroid falls outside its own footprint. The wrong street names are midpoints
that land in a junction, where the cross street is equally right.

The Richmond and three gap regions (Daly City, Alameda, Belmont) were not sampled: their data
lives only in the cloud store, which a local test server may not read (doc 19).

## Structures: do bridges and highways stand where they do?

See doc 34 for the full table.

- A jump to the Golden Gate lands on its deck at 65.5 m. The bridge's published navigation
  clearance is 67 m at mid-span, measured to the *underside* of its 7.6 m stiffening truss, so
  the real roadway is about 75 m up. The modelled deck is roughly 9 m low: an open item.
- A walker stays on the deck for a kilometre.
- The Bay Bridge west span has both decks, at 56.2 m and 45.7 m.
- In the Mission, 14 of 16 deck ways are highways a walker stands on, and walkers under 12 of
  12 elevated decks stay on the street.

## Visual: does it look like what is there?

| Place | What it showed | Verdict |
|---|---|---|
| Golden Gate span | Towers, cables, deck, approach viaducts | Reads correctly |
| Marin Headlands | Before: tall eucalyptus and pine on bare khaki ground. After: continuous dark scrub, grass on the lower slopes, few trees | Fixed in this pass (doc 35) |
| San Bruno Mountain | Scrub hillsides with trees in the ravines | Fixed in this pass |
| Ocean Beach | Sand along the whole beach, no stray shrubs | Fixed in this pass |
| Coyote Hills | Golden grass on the hills, green marsh, ponds | Reasonable; marsh colour could be truer |
| Downtown Oakland | Towers, plazas, street trees, crossings | Reads correctly |
| Mission interchanges | Decks present and walkable, but stacked levels drawn at one height | Plan in doc 34 |
| Richmond, gap regions (local server) | Roads only | Store-only data, not readable from a local server (doc 19) |

## One edit, end to end

On 1535 Francisco Street (OSM way 263276313, in the Marina region): picked from the screen as
a person would, then the editor opened.

| Step | Result |
|---|---|
| Open the editor | Shows the front the world draws: 5 openings, 25 meshes on the wall |
| Tap "+ Window" | The wall picture re-renders 362 ms later with the new window, marked "Preview: not saved yet"; nothing saved |
| Save changes | "Saved on this device. Verify your account to change it for everyone." |
| Close, then reload the page | The edit is drawn on the building in the world, 30 meshes |

Before this pass, the same test showed a blank wall. Tapping changed the editor's diagram but
not the building, and the saved edit was never drawn, because the editor looked for the
building in the page's own data rather than the region's. Fixed (doc 19). Regions now also
draw the edits saved from verified accounts.

**The canonical world** (what everyone sees) needs a verified editor account, which these
samples did not have. Saving from one sends the edit to the shared database, and every page,
regions included, draws it on its next load.
