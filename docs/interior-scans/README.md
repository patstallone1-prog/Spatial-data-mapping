# Real scanned interiors: matched visual stand-ins

This pilot uses the **real Redwood Apartment reconstruction**, not an authored
CAD apartment or a catalogue thumbnail. Three house placements share one GLB.
None depicts the matched address's actual interior. Matching uses residential
class, storey count, footprint proportions, complete-vertex containment and a
terrain/entrance preflight. Of the two contained rigid orientations, the matcher
aims the host doorway toward the largest observed open-floor region rather than
a small furnished bedroom or an unobserved margin. Actual floor-plan similarity cannot be known without
an observation of the target house; the manifest states this limitation.

Source: [Redwood Indoor Lidar-RGBD Scan Dataset](http://redwood-data.org/indoor_lidar_rgbd/download.html).
The authors' [data licence](http://redwood-data.org/indoor_lidar_rgbd/license.html)
permits reuse of the scans and reconstructions and requests attribution.
Credit: Jaesik Park, Qian-Yi Zhou and Vladlen Koltun,
*Colored Point Cloud Registration Revisited*, ICCV 2017.

The original reconstruction is also included in the ETH archive linked by the
[NICE-SLAM authors' downloader](https://github.com/cvg/nice-slam/blob/master/scripts/download_apartment.sh):
`https://cvg-data.inf.ethz.ch/nice-slam/data/Apartment.zip`, member
`Apartment/scene/integrated.ply`. `remotezip.RemoteZip.extract` retrieves this
member using HTTP ranges without acquiring the 5.5 GB RGB-D sequence.

Build tools:

```sh
uv pip install --python .venv/bin/python -e '.[scan-build]'
PYTHONPATH=src .venv/bin/python scripts/prepare_redwood_interior.py /path/to/integrated.ply build/apartment.glb
PYTHONPATH=src .venv/bin/python scripts/build_scanned_interiors.py build/apartment.glb
PYTHONPATH=src .venv/bin/python tools/build_app_worlds.py
```

The source mesh has 8,748,119 vertices and 17,142,174 triangles. The display LOD
averages 6 cm voxels and retains 149,321 triangles in a 3,913,376-byte GLB. A single
rigid floor-plane alignment levels the capture; placements allow only uniform
scale within 10% of its source size. This is **not centimetre-accuracy evidence
for the target house**. Floor fit residuals quantify leveling of this source
scan, not accuracy at its borrowed address. Original vertex colours are retained;
this is not a high-resolution photographic texture atlas.

The manifest records source and asset hashes, rights, attribution, geometry,
room-sized floor regions, surrogate-only navigation walls and placement checks.
Source room segmentation excludes small/poorly observed floor patches. A neutral
under-floor substrate covers unobserved gaps, explicitly labelled inferred.
The camera remains below room wall/ceiling height; walls are not hidden to expose
adjacent rooms. The avatar is hidden in ceiling mode because its head otherwise
occludes the room. First-person remains available.

Where a borrowed scan's outer wall blocks the host entrance, a door-sized opening
is cut into a per-placement visual copy within 1.5 m of that existing doorway.
Only that opening's navigation wall is removed; neighboring partitions remain.
The inspector reports this as an **inferred entry adapter**, not scanned evidence.
The shared source GLB and its checksum remain unchanged.

Only the ground-storey appearance is replaced. Existing fitted upper storeys
remain **inferred**, not scanned. Windows, textures and missing surfaces within
the borrowed scan reflect its acquisition limitations; this pilot does not
claim a complete photoreal reconstruction of these houses. Canonical footprints,
height data and factual exports remain untouched. Surrogate wall segments affect
only the demonstration walker, never the robot-navigation facts table.

Every source may have **at most eight placements across the entire manifest**.
Runtime checks fail back to the procedural interior if hashes, dimensions,
rights-manifest contract or footprint containment no longer agree. CI checks all
three placements, the reuse limit, source bytes and canonical payload hashes.

Current pilot addresses are listed in `manifest.json`. The roughly 347 Sketchfab
catalogue candidates remain undownloaded; the account-gated collection is not
misrepresented as hundreds of published scanned homes.
