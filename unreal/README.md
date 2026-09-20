# Kerbside on Unreal

The Unreal project is a consumer of the repository's data, not a second copy of it. The page's
own JavaScript builds the corridor; `tools/unreal/export_tiles.mjs` runs that build headless
with the real three.js and writes the result as 250 m glTF tiles; the editor script imports
them. Nothing about the city is authored in Unreal.

## What is here

- `Kerbside/Kerbside.uproject` — UE 5.4 project: EOS (Online Subsystem EOS, EOS Shared,
  Online Services EOS), Interchange glTF import, World Partition HLOD, Enhanced Input, Python
  editor scripting.
- `Kerbside/Config/DefaultEngine.ini.template` — rendered to `DefaultEngine.ini` by
  `tools/unreal/write_config.py` from `.env.local`; the rendered file is git-ignored because it
  carries the EOS client secret.
- `Kerbside/Content/Kerbside/import_tiles.py` — runs inside the editor: imports every tile
  from `build/unreal/manifest.json`, enables Nanite, assigns materials by surface name, places
  the tiles in the `Corridor` level.

## Once, on this machine (needs the Epic account)

1. Install the Epic Games Launcher and Unreal Engine 5.4 (macOS: launcher → Unreal Engine →
   Library → 5.4.x). Xcode is required for the C++ module; the launcher will say so.
2. In the EOS Developer Portal, product **Kerbside** → Product Settings → Clients → *Add New
   Client*: name `KerbsideGame`, client policy **Peer2Peer** (a game client that may host and
   join). Copy the Client ID and Client Secret into `.env.local` as `EOS_CLIENT_ID` and
   `EOS_CLIENT_SECRET` (the product, sandbox and deployment ids are already there).
3. Render the engine config (never commit the result):

   ```bash
   set -a; source .env.local; set +a; .venv/bin/python tools/unreal/write_config.py
   ```

4. The tiles: either export them here (a minute or two; ~500 MB under `build/unreal/`) --

   ```bash
   node --max-old-space-size=14000 tools/unreal/export_tiles.mjs
   ```

   -- or do nothing: `import_tiles.py` downloads the published archive (160 MB, checksummed)
   from the repository's `unreal-tiles-v1` release when `build/unreal/` is empty, so an Unreal
   machine needs only this repository checked out.

5. Open `unreal/Kerbside/Kerbside.uproject` (it compiles the module the first time), then
   Tools → Execute Python Script → `Content/Kerbside/import_tiles.py`. Materials named in the
   script that do not exist yet leave the tile on its vertex colours; make them under
   `Content/Kerbside/Materials` and re-run.

## Frame

Tiles are in the page's local frame: metres east and north of the corridor's middle
(`manifest.json` → `frame.mid_lon`, `frame.mid_lat`), heights in NAVD88 metres from the lidar
terrain. glTF is y-up metres; Interchange turns that into Unreal's z-up centimetres. A tile's
south-west corner is at `(x0, -z0)` metres.

## Licences carried across

The tiles derive from OpenStreetMap (ODbL), the City's open records, USGS 3DEP lidar and the
project's own measurements; the same reference-only discipline applies inside Unreal as in the
repository, and the project stays non-commercial.
