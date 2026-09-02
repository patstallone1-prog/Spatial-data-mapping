# Kerbside SF Corridor Metadata Seed

This catalog covers the bounded San Francisco corridor:

- Marina
- Cow Hollow
- Russian Hill
- North Beach
- Chinatown
- Financial District / Downtown

Bounding box:

- north: `37.8095`
- south: `37.7860`
- west: `-122.4475`
- east: `-122.3920`

The committed dataset is metadata only. It does not mirror KartaView or Panoramax
source imagery into Git. Pixel fetches are resolved on demand by provider id,
normalized to the Meta pixel-budget ceiling only while processing, and discarded
unless a debug cache is explicitly requested.

Current seed run:

- Provider completed: Panoramax
- Observations: 1,261
- Eligible observations: 1,261
- Sequences: 8
- H3 coverage cells: 122
- Source imagery committed: no

KartaView provider support is present in `src/smc/imagery/kartaview.py`, but the
live seed run did not include it because its current sequence fetch path can
stall on old high-volume sequences and can return frames outside the requested
bbox. The ingestion script filters observations back to the bbox and records
provider errors; the next hardening pass should add KartaView page checkpointing.
