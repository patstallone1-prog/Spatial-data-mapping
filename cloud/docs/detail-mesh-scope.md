# Scope: a measured 3D detail mesh, streamed from the cloud (2026-10-29)

**Goal.** Replace the drawn-from-rules houses and streets near the walker with a mesh measured
from street photographs, and stream the whole world from the cloud instead of from the
site's own files.

**Starting point.** The method is already written up in `docs/photogrammetry-audit-2026-09.md`:
sequence-based structure from motion, dense stereo, lidar alignment, conservative promotion. What
is new since then is the cloud: RunPod GPU and CPU pools, S3 and CloudFront behind the site's
`/store` address, a job queue with budgets, gates and promotion. This scope fits the audit's
method into that system.

## What exists, and what is missing

| Piece | State |
|---|---|
| Photo metadata | About 516k Mapillary rows in the 8 local regions (308k on the corridor), plus each cloud cell's own catalogue. KartaView and Panoramax rows are allowed per observation. Street View, Waymo and PandaSet are never used. |
| Photo pixels | None stored. The house filter fetches single frames, never whole sequences. |
| Lidar truth | USGS 3DEP point clouds for most cells (the `lidar` stage), archived in the private bucket. |
| GPU pool | RunPod RTX A5000-class at $0.27–0.60/h, one at a time, currently used for house batches. |
| Reconstruction code | `scripts/run_photo_mesh_pilot.py` runs a sparse CPU pilot with COLMAP. There is no dense mesh, no texturing and no tiling yet. |
| Streaming | Cells' JSON payloads go from the public bucket through CloudFront. The viewer's streaming (`docs/world-streaming.mjs`) loads windows of procedural geometry; there is no glTF loader. |
| Viewer pages | Every cell commits its own 1.9 MB copy of the viewer, and the 8 local regions' payloads live in `docs/`. |

## The build, in five phases

### 1. Pilot: four cells, measured end to end (about 1 week, about $15)
- **Image:** a GPU image with COLMAP 3.x (CUDA), hloc with ALIKED and LightGlue, and OpenMVS.
- **New stage `photos` (CPU):** fetch whole Mapillary sequences for a cell at 2048 px into the private bucket, with original and decoded hashes, licence and attribution. Mapillary already blurs faces and plates; the stage also masks people, vehicles and sky before matching.
- **New stage `mesh` (GPU):**
  - structure from motion with GNSS priors, then dense stereo
  - fuse into a mesh, then split it into building, ground, vegetation and street objects
- **New gate `mesh-check`:**
  - align to the cell's lidar on a training subset, then score on held-out checkpoints
  - hold the cell if the median error is over 0.15 m or the 95th percentile over 0.5 m, or if fewer than 60% of cameras register
- **Cells:** the audit's four adjacent corridor cells, `c13r03`, `c13r04`, `c14r03` and `c14r04`.
- **Done when:** a pilot cell's mesh shows a house's real stoop, bays and cornice within those errors. It is published only to a hidden test path.

### 2. Tiles and textures (about 1 week)
- **Tile and compress:** cut each cell's mesh into 125 m tiles at three detail levels (about 2 cm, 10 cm and 50 cm). Compress geometry with meshopt and textures with KTX2.
- **Tileset:** write a 3D Tiles 1.1 `tileset.json` per cell.
- **Textures:** bake from the masked photos at no more than 1.25× the source detail. Keep each texel's sources so attribution and takedowns work.
- **Size target:** 2–6 MB per tile at the finest level; under 40 MB for a full cell at the coarsest.

### 3. In the viewer (about 1 week)
- **Loading:** three.js `GLTFLoader` with the meshopt and KTX2 decoders, loaded only on demand like the editor. Fine tiles within 150 m of the walker, coarser out to 600 m; the existing streaming windows schedule them.
- **Replacing drawn houses:** where a measured tile covers a footprint, its drawn house is hidden. The footprint stays for collision, doors and interiors.
- **Physics:**
  - the walker keeps the canonical ground and footprints
  - measured stairs and ledges become standing surfaces only after the gate, as the editor's inferred stairs already are
- **Headset:** coarse tiles only, within the memory governor.

### 4. The whole city (cloud time, not people time)
- **Order:** the `photos` → `mesh` → `mesh-check` → `publish` chain on every finished cell, densest photo coverage first, and only for cells that pass the pilot's gate. Thin suburbs will hold, as the imagery redo showed.
- **Throughput:** about 1,000 images an hour per A5000, covering matching, stereo and meshing.

### 5. Stream everything from the cloud (about 1 week)
- **One viewer page:** reads the region list and asset map from `/store`. The 8 local regions' payloads and tiles move to the public bucket.
- **Retire the copies:** the per-cell `app-model.html` copies are deleted (50 today, 339 at the end), so `docs/` holds only the viewer code.
- **Cache safety:**
  - the service worker caches by the asset map's content hashes, so a promotion is atomic for users already on the page
  - a rollback is moving the asset-map pointer back
- **Offline and the app:** offline packs (the "make available offline" button) download a region's tiles from the same URLs.

## Cost (list prices, 2026-10)

| Item | Estimate |
|---|---|
| GPU, whole corridor plus the 8 regions (about 450k usable images) | 450–600 A5000-hours: **$120–360** |
| GPU, each cloud cell (median a few thousand images) | about $1–3 a cell |
| Private photo store (2048 px originals, about 0.5 MB each) | about 250 GB: **about $6/month** |
| Public tiles | about 5–15 GB a region: under $5/month |
| Viewer egress through CloudFront | the first 1 TB a month is free, then $0.085/GB |

At the $60 daily limit the corridor and the 8 regions take about 2–3 weeks of GPU time with one GPU. A second GPU worker (`pools.gpu.max_workers = 2`) halves that at the same total cost.

## Risks and decisions for you

- **Licences:** Mapillary is CC BY-SA, so published textures carry attribution and share-alike. KartaView and Panoramax are decided per photograph. The audit's rule stands: an "eligible" row is not a licence decision.
- **Privacy:** Mapillary's blurring plus our own masks. A sample of every cell's textures is reviewed by a person before publishing, like the held-cell review today.
- **Thin coverage:** measured detail only appears where people photographed. The drawn houses remain everywhere else, so the map is a mix, labelled by source.
- **Gaussian splats instead of a mesh:** they look more photographic for less work, but have no surfaces to walk on or edit, and cost more memory on the headset. A mesh is recommended, with splats possible later for the far view.
- **Decision needed:** whether to start phase 1 now. It needs the GPU image built (about 15 minutes of CI) and about $15.

## Build started (2026-10-30)

The owner said start. What exists now, in `src/smc/worldmesh/` and `scripts/build_world_mesh.py`:

- **Any block.** A block is a rectangle and an origin (`block.py`). It owns the triangles whose centroids fall inside it, so blocks laid edge to edge cover the world exactly once. A cell is cut into ~200 m blocks (`tiles_of`), and each block is built on its own, in any order, on any machine.
- **Photographs** (`photos.py`): Mapillary frames in a 40 m halo, at original resolution, one folder per sequence, each with its SHA-256, licence and creator. The only thinning drops near-repeats (closer than 1 m to the last kept frame in a sequence) and 360 frames.
- **Solve** (`reconstruct.py`): COLMAP 4 from the command line, resumable phase by phase.
  - The sparse half runs anywhere, including this Mac's CPU build: full-size SIFT, neighbour and sequence pairs, mapping, then alignment to the block's metres.
  - Each camera sits 2.2 m above the USGS 3DEP ground where it stood (`ground.py`).
  - The dense half (full-size patch-match, fusion, depth-13 Poisson, about 2.4 cm cells) needs CUDA COLMAP. The GPU image now builds COLMAP 4.2.1 with CUDA (sm 8.6/8.9/9.0).
- **Tiles** (`tiles.py`):
  - **Leaves** hold every master triangle, whole and undecimated. Positions are 16-bit per tile (rounding is measured: about 0.2 mm for a 120 m test block), and textures are kept byte for byte.
  - **Parents** are simplified with meshoptimizer to about one leaf's size, with borders locked. Their error is the simplifier's measured value in metres.
  - **Encoding:** everything is compressed with EXT_meshopt_compression and KHR_mesh_quantization, and a 3D Tiles 1.1 tileset plus a manifest are written. A test block came to about 4.5 bytes a triangle with colour and normals, and loads seamlessly in three.js r160 through its meshopt decoder.
- **Check** (`check.py`): the scope's gate.
  - Hold a block when under 60% of its cameras register, or when it sits a median over 0.15 m or a p95 over 0.5 m from the lidar.
  - A block with no lidar given is held as unmeasured.
- **Cloud:** `smc-cloud plan --mesh <cells>` queues two jobs per block. `mesh:<block>:photos` runs on CPU; `mesh:<block>:solve` runs on GPU and does the solve, tiles and check. Both are optional, and neither publishes anything.

Still to do:
- Feed each block's lidar to the check from the cell's archived points.
- Texture the master mesh (OpenMVS TextureMesh). Leaves are vertex-coloured until then.
- The viewer loader (phase 3).
- The pilot run itself, which needs RunPod credit.
