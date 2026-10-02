# Unreal + NVIDIA Movement Runtime Plan

The Unreal version should not be a hand-built copy of the web map. It should consume the same canonical city data and turn it into a licensed, editable world substrate: roads, curbs, sidewalks, yards, buildings, materials, semantic labels, collision, and physics surfaces.

## Direction

Keep the source of truth engine-neutral. The repo should continue to own observations, measured surfaces, footprints, addresses, building types, provenance, confidence, and chunk manifests. Unreal, the web viewer, robotics simulation, and future license exports should all read from that layer.

Export simulation-ready tiles. Each tile should have a visual mesh, simplified collision mesh, material assignments, and a metadata sidecar. Use `USD` for Isaac/Omniverse-style simulation workflows, and `glTF`, `GLB`, or `FBX` for Unreal import when that path is cleaner.

Use Unreal as the playable runtime. Unreal should stream the world with World Partition, render dense geometry with Nanite where appropriate, use Chaos for collision, and expose editable semantic actors for businesses, parcels, curb cuts, parking, hazards, spawn regions, and navigation regions.

Use NVIDIA as the movement and physics lab. The practical open-source route is Isaac Lab plus Warp/Newton-style GPU simulation and differentiable physics. Train and validate natural movement there, then bridge proven policies back into Unreal. This is not a one-click "NVIDIA character plugin" path.

## Phase 1: Unreal Baseline

Start with one 250 m tile. Export render meshes, collision meshes, material IDs, and metadata. Import it into Unreal as a World Partition level or plugin content pack.

Use Unreal Enhanced Input, Character Movement, Animation Blueprint, Control Rig, IK foot placement, and Motion Matching where available. Movement should read terrain metadata such as curb height, sidewalk slope, road material, grass, sand, stairs, ramps, driveways, alleys, crosswalks, fences, and walls.

Success for this phase means a player can walk, run, step up curbs, slow down on grass or sand, avoid blockers, and collide predictably.

## Phase 2: NVIDIA Training Harness

Export the same tile to `USD` with simplified collision and semantic surface labels. Load it into Isaac Lab for locomotion, traversal, navigation, and policy testing.

Use Warp or Newton where GPU-parallel simulation helps with contact behavior, gait tuning, and repeated tests across many city chunks.

Train against city-specific cases: curb steps, curb ramps, sidewalk seams, alleys, crosswalks, beach edges, courts, fences, stairs, steep sidewalks, and storefront clutter.

## Phase 3: Unreal Policy Bridge

Export trained policy artifacts to `ONNX` or another Unreal-callable runtime format. Wrap the result behind a movement component interface.

Inputs should include desired velocity, camera direction, local height samples, surface labels, slope, obstacle distances, and current gait state.

Outputs should include root-motion target, footstep plan, gait state, or lower-level joint targets. Keep a normal Unreal Character Movement fallback so licensing customers can use their own controllers and characters.

## ARDY + MotionBricks Bridge

Treat ARDY and MotionBricks as motion generation and retargeting stages, not as the canonical world runtime. The world exporter should produce surface and collision training scenes; the NVIDIA-side harness should produce motion clips, policies, or pose streams; Unreal should consume those through a movement component, animation blueprint, or retargeted skeletal animation layer.

For the web demo, use a remote skinned GLB character with idle and locomotion clips. That proves the map can host a real character scale and animation path without adding a large binary asset pipeline to the repository. The Unreal prototype can then replace the browser demo avatar with a licensed MetaHuman, marketplace character, or ARDY/MotionBricks-retargeted rig.

## Data Work Needed

Build `tools/export_unreal_tiles.py`. It should chunk by grid cell, write visual mesh, write collision mesh, assign materials, emit metadata, and enforce storage budgets.

Extend the physics surface schema with `surface_type`, `friction`, `restitution`, `step_height_m`, `slope_deg`, `walkable`, `blocks_player`, `confidence`, and `source`.

Generate separate collision from visual geometry. Buildings should become stable blockouts, curb ramps should be sloped wedges, sidewalks should be walkable slabs, fences and walls should be thin blockers, and water, sand, and grass should be tagged surfaces.

Add editable override layers for licensees. Overrides should be reversible deltas over canonical geometry, with validation that edited physics still supports navigation and collision.

## Character Strategy

The web viewer should keep a self-contained humanoid walker for scale and debugging. Do not import a third-party realistic character into this repo unless redistribution rights are explicit.

For Unreal, use owned character art, a MetaHuman or Unreal Marketplace character with compatible terms, a permissively licensed character with recorded provenance, or a temporary procedural placeholder.

## Licensing Position

The product should license derived, verified world geometry and metadata, not restricted imagery. Every generated mesh and semantic claim should retain provenance. Third-party character assets should only enter the repo when redistribution rights are clear.

## Near-Term Milestones

1. Keep the web debug avatar as a humanoid walker so street scale reads correctly now.
2. Add an engine-neutral tile export manifest.
3. Prototype one 250 m Unreal tile with visual mesh, simplified collision, and physical materials.
4. Export the same tile to `USD` and load it in Isaac Lab.
5. Train and test navigation on curbs, ramps, sidewalk seams, sand, grass, alleys, and crosswalks.
6. Define the Unreal movement component API so games can swap in their own character physics.
7. Add validation scenes for curb step, alley crossing, tennis court fence, gas station canopy, beach edge, and dense storefront block.

## References Checked

- NVIDIA Isaac Lab: https://isaac-sim.github.io/IsaacLab/
- NVIDIA Warp: https://nvidia.github.io/warp/
- NVIDIA Newton Physics Engine: https://developer.nvidia.com/newton

## Status (2026-09-30): what is installed, and what this machine cannot run

**MotionBricks — installed, used offline.** NVIDIA's MotionBricks ships inside
[NVlabs/GR00T-WholeBodyControl](https://github.com/NVlabs/GR00T-WholeBodyControl/tree/main/motionbricks)
(code Apache-2.0, weights under the NVIDIA Open Model License, which allows commercial use with
attribution). It is Python/PyTorch only — there is no C++ version — and its documented
requirement is a CUDA GPU on Linux. It is cloned beside this repository
(`../vendor/GR00T-WholeBodyControl`, `motionbricks/` only, its own virtual environment
`.venv-mb`), with its four checkpoints (G1-clip, VQ-VAE, root, pose; 2.2 GB) fetched through the
Git LFS batch API and checked against their SHA-256. The model drives a Unitree G1 skeleton.

The page is a browser, which cannot run a PyTorch model at 1.6 GB, so MotionBricks is used the
way this document planned: as a motion-generation stage. `tools/motionbricks/bake_clips.py`
runs it on this Mac (Apple GPU through MPS, else CPU), drives its own controller straight ahead
in four modes — idle, slow walk, walk, jog — cuts each to one looping gait cycle, and writes the
G1's joint positions per frame to `docs/sf-corridor-motionbricks.json`. The page retargets them
onto its character at load by matching directions (hips to the G1 pelvis frame, each thigh, shin,
upper arm and forearm to the matching G1 segment) and plays the cycle whose speed, scaled to the
character's size, is nearest the ground speed, sped up or slowed to match.

**Isaac Lab — not installable here.** Isaac Lab runs on Isaac Sim, which supports Ubuntu and
Windows with an NVIDIA RTX GPU; this machine is an Apple M4 on macOS. A community fork
(IsaacLab-MLX) claims to run part of it on Apple Silicon; it is not NVIDIA's and was not
installed. What Isaac Lab was for here — gravity and the walker's contact with the world — is
done in the page meanwhile: the walker falls under gravity off any edge and lands, climbs what a
stride climbs (0.45 m) and no more, steps down stairs without falling, jumps (Space), and is held
off buildings and furniture. When an RTX machine is available the plan above stands: export the
tiles to USD, train locomotion in Isaac Lab, and bring policies back.
