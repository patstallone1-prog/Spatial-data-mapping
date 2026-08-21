# CARLA Harness

Built 2026-08-20. Code in `src/smc/carla_gen/`, tests in `tests/`.

```bash
python -m smc.carla_gen build --out build/dc-14th --id dc-14th --blocks 12
```

Emits an OBJ of the corridor, `ground_truth.json` (the exact answer key), and `provenance.txt`
(which profile parameters are standards and which are guesses).

---

## 1. The constraint that shaped the design

CARLA **hard-codes sidewalk height** in OpenDRIVE standalone mode. The format carries no height
value for RoadRunner to export, so CARLA fixes one so collisions work. `generate_opendrive_world`
exposes `vertex_distance`, `max_road_length`, `wall_height`, `additional_width`, `smooth_junctions`
— nothing that varies a curb.

So randomised curb geometry cannot come from the road network. It is generated as real triangle
meshes and imported as props. That is more work than an `.xodr` parameter, and it is also the
only version that can be ground truth: the curb height in the render is a literal dimension of
the mesh, not an annotation beside it.

## 2. What was built

| Module | Role |
|---|---|
| `units.py` | Imperial↔metric, and the ADA/PROWAG thresholds as named constants |
| `profile.py` | Jurisdiction sampling profile + **provenance audit** |
| `distributions.py` | Hierarchical, identity-seeded sampling of block faces, segments, ramps |
| `geometry.py` | Parametric cross-section lofting → triangle meshes |
| `meshio.py` | OBJ export (portable, not pinned to the Unreal pipeline) |
| `gnss.py` | Gauss-Markov + multipath GNSS error, calibrated to literature |
| `sensors.py` | Stereo rig matching the physical Tier 2 hardware |
| `scenario.py` | Drive planning and capture records; CARLA guarded behind `carla_available()` |
| `world.py` | Corridor assembly, ground-truth export, mesh fidelity verification |
| `facts/` | The served `WorldFact` and the separate `GroundTruthFact` |

81 tests, lint clean, no CARLA install required to run any of them.

## 3. Four design decisions worth defending

**Sampling is hierarchical.** A block face is one concrete pour, so its curb height is correlated
along its length, and its build quality drives compliance and surface condition together. IID
sampling would produce a street that is statistical noise, and an engine tuned against noise
learns nothing about corroboration — the exact mechanism multi-view fusion exists to exploit.

**Sampling is identity-seeded, not stream-seeded.** Geometry derives from
`blake2b(world_seed, feature_identity)`, so the second pass down a block sees *the same curb* in
any order, in any process. Without this the corroboration claim is untestable.

**Non-compliance is modelled explicitly.** Slopes are a two-population mixture: a compliant body
plus an exponential tail past the limit. A simulation of only compliant geometry would let the
engine pass every gate and then fail on a real street, because the commercially valuable facts
are precisely the non-compliant ones. Current defaults yield ~24% of ramps over the 8.33% running
slope, ~25% of corners with no ramp at all, 6.5% of joints over ¼ in, 1.8% over ½ in, and ~39% of
60 m segments fully ADA-passable.

**Truth is a different type from a served fact.** `GroundTruthFact` has no confidence, no
provenance, no corroboration count. Reusing `WorldFact` for truth would make it possible to
compare a fact against itself and to leak a truth row into the product.

## 4. Findings the code produced

**The 0.20 m stereo baseline is too narrow.** Depth uncertainty goes as Z²/(f·b). At f=960 px
and b=0.20 m, ±0.15 m depth is met only to **7.6 m** — but the curb sits 5–12 m from a traffic
lane. Two consequences:

- Widen the rig baseline to **~0.50 m** (a windshield is ~1.4 m across; this is free). That
  reaches ~12 m at the same tolerance.
- More importantly, this reframes the roles. **Rigid stereo is for metric scale; the motion
  baseline is for precision.** At 8 m/s and 4 fps, consecutive frames are **2.0 m** apart — ten
  times the rigid baseline. The stereo pair's job is to pin absolute scale exactly; multi-view
  along the drive supplies the geometry.

This is asserted in `tests/test_simulation.py::test_the_20cm_baseline_cannot_reach_the_curb_at_tier_b`
so it cannot regress silently. **The BOM in `04-capture-rig-and-simulation.md` should be updated
to a 0.50 m baseline before ordering.**

**GNSS error must be correlated or the sim lies.** CARLA's built-in GNSS applies independent
Gaussian noise per axis. Real error drifts over minutes, so averaging a pass does not remove it —
in the model here, averaging 120 frames over a 30 s pass reduces mean error from 17.70 m to
17.47 m. With independent noise it would have collapsed toward zero and handed the anchoring
step an accuracy it will never have. The crowdsourced mix reproduces **5.15 m** mean deviation
against the ~5.5 m reported in the literature.

**`distance_m`, not haversine, is the scoring metric.** A spherical formula cannot agree with an
ellipsoidal ENU frame better than ~2e-3, and the disagreement is *directional* — north long, east
short. A scoring metric with directional bias would favour features positioned along one axis.

## 5. What is still open

**The Unreal asset import is not done.** The OBJ is generated; loading it into CARLA needs a
source build and a content package (`Import assets into a package` workflow). Until that lands,
`render_drive()` raises rather than pretending. Everything upstream of rendering — sampling,
geometry, ground truth, drive planning, GNSS, fidelity — runs and is tested today, and
`simulate_drive()` produces the full frame record with realistic GNSS error so association and
fusion logic can be exercised before the renderer exists.

**CARLA cannot simulate rolling shutter.** Frames render instantaneously. So the sim cannot
demonstrate why global shutter was chosen; that argument has to be settled on real hardware.

**93% of the profile is estimates.** The distribution shapes are defensible engineering priors,
not measurements. They are the weakest link in every accuracy number derived from simulation,
which is why `python -m smc.carla_gen audit` exists and why `provenance.txt` ships beside every
generated corridor. Replace them via `CurbProfile.from_municipal_survey` using the curb-ramp
inventories already identified in `01-dependency-stack.md`.
