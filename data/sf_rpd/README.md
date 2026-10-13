# SF Recreation & Parks source snapshot

`manifest.json` selects the current `inventory.json.gz` and records both compressed
and decoded hashes. This is ingested source evidence, **not yet viewer-integrated**.
Use `scripts/ingest_sf_parks.py` to reproduce it. The three PDDL source snapshots
are in `snapshots/`, named by their original canonical-row hash, and retain every
source geometry, attribute, timestamp and alias.

Facilities are logical collections scoped by property ID because the real source
reuses some legacy facility IDs. Distinct GIS `OBJECTID` parts retain their own
geometry and attributes. Conflicting roles or missing park identities are reported;
they are not attached to a nearby park by name. Surface and accessibility remain
unknown unless independent explicit evidence supports those facts.

`raw/` is a regenerable download cache. `archive/` is not an input or a source
template. In particular, the first-draft uncompressed inventory had unscoped
legacy IDs; it is retired and must never be used for rendering.
