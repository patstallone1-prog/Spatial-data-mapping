# Measured curb archive

The live renderer currently uses a uniform curb height (`KERB_RENDER_UNIFORM = true` in
`scripts/build_sf_corridor_3d.py`). That is a **visual override**, not a deletion or a
correction of measurements. Some measured faces were demonstrably wrong, so the archived
numbers are unreviewed evidence, not automatically fit to publish as true heights.

| File | What it retains |
| --- | --- |
| `sf_per_way_heights_archive.json` | Snapshot of every SF way's `kerb_m` and available sample count, uncertainty, and source from the published map payload; includes SHA-256 of the exact source JSON. Rebuild with `python scripts/archive_measured_curbs.py`. |
| `../sf_public_works/curb_profiles_corridor.json` | 1,477 per-street curb-to-curb **horizontal width** profiles and station samples; not curb heights. |
| `../sf_public_works/curb_profiles_c14r03.json` | Focus-cell horizontal width profiles. |
| `../sf_public_works/curb_cuts.json` | Mapped curb-cut locations. |
| `../waymo_sf/curb_sections.jsonl` | Per-station lidar curb-height candidates with point counts, uncertainty, and flags. |
| `photo_vs_lidar.jsonl`, `photo_vs_lidar_run.json` | Photo/lidar comparison fixtures and run metadata (currently no comparison samples). |

The full, unslimmed lidar-region files are produced under
`data/regions/<region>/lidar/kerb_heights.json` when regional ingestion runs. Those generated
files are not a substitute for the tracked snapshot above and must be backed up separately
before removing a local build directory. The app and Unreal export should retain the uniform
render policy until the measured outliers have been reviewed. To restore measured rendering,
first audit the source and outliers, then disable the policy and rebuild the app/tiles; the
archive itself does not modify the canonical map.
