# Plant scans for the forest floor

How `docs/nature/models/` was made from Poly Haven's CC0 glTF models (1k):

1. Download each model's glTF files from `https://api.polyhaven.com/files/<id>` into `src/<id>/`
   (and its file list as `src/<id>.files.json`).
2. `python prep.py` — textures to 512 px, the cut-out alpha merged into the diffuse PNG, arm maps dropped.
3. `npm install && node simplify.mjs` — weld and simplify (meshoptimizer), written as `out/<id>.glb`.
4. `node lod1.mjs` — geometry-only far versions (`<id>.lod1.glb`) at about 1/8 of the triangles.

Copy `out/*.glb` and the manifest into `docs/nature/models/`; `tests/test_forest_floor.py` checks
every file against the manifest's sha256. Work in a folder off the internal disk (the run used
`/Volumes/HP P700 1/Kerbside/plant-assets`).
