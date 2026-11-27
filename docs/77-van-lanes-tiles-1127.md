# Delivery van, lane merges, sliced tiles, 2026-11-27

This pass finishes what [76](76-frame-freezes-1127.md) left open, and the two items dropped from it:
the white truck and the drivers' lanes.

## The van

The traffic's delivery vans are now a real high-roof van, a Ram ProMaster 3500 159" (the same body
as the Opel Movano and the Fiat Ducato). The model is CharlotteUA's free "Modern delivery van" on
CGTrader (royalty-free licence, no AI). Its sizes are those of the US van: 2.05 m wide without the
mirrors, 2.52 m tall and 6.36 m long.

It is converted like the other four cars (`scripts/blender_city_cars.py`, then
`scripts/build_city_cars.mjs --only promaster`), into a full, npc and mid model of 90.5k, 11.8k and
1.7k triangles. On the way:

- Every piece's own transform is now applied to its mesh. Some FBX pieces kept centimetres or their
  parent's turn, and the van came out 15 m tall.
- The model came with its back doors open. `open_doors` turns the pieces in two boxes 180° about
  their hinge, and the doors are shut.
- The cargo space, the rack and the floor inside are dropped.
- A full-detail part far over its budget is simplified: the tyres alone were 36k triangles.

**Gone:** the Kenney delivery, van, truck and garbage-truck models, and the code-built tow boom,
post, cable and hook.

- Pickups and tow trucks are the Nissan Frontier.
- A tow truck keeps its beacon lamps and still lifts the wreck on its hitch.
- The box truck stays the imported White Shipping Truck.
- The ambulance and the fire truck are still Kenney.

## Lanes that end, merges and signals

**Lanes by block.** The street's lane count changes block by block, as the paint does. Where the
census has parking blocks, each block's lanes are what fit in the width left beside its stalls
(`way._laneBlocks`, module 06, read as `lane_blocks` by `Streets.addWay`). A driver's lanes are now
the painted lanes, and a lane that ends where parking starts ends for the drivers too.

**Leaving a lane that ends** (`laneDropAhead`, `pickLane` in fleet.mjs):

- A driver sees the drop up to 120 m ahead.
- From then on the ending lane counts as crowded, and the driver does not choose it.
- A driver in it signals toward the lane that goes on, and is slowed so as not to run past the end.
- The lane is changed only into a gap.
- After 5 s waiting, a tighter gap is taken, as people do in a zip merge.
- No car is ever carried across the end.

**Signals before every lane change.** The blinker is on for 1.2 s before the change and goes off
once the car is over. A driver signals 40 m before a turn, left or right as the route turns.

**Blinkers are drawn.** Amber lamps flash at 1.5 Hz at the front and back corners on the signalled
side, one instanced mesh for the whole fleet. They are not drawn on the far tier.

**The lines.** White lane lines are dashed: drivers may cross them, and they do so only to change
lanes. The double yellow is solid and never crossed. Lines stop short of the junctions, and drivers
do not change lanes in a junction box.

## Frame work

- **Host tile builds are sliced across frames.** `buildTile` is async. It yields a frame whenever
  the frame's budget is spent: after the massing, after the buildings, every 48 lawn rows, between
  road layers and between the nature bases. The ground memo is kept within each slice.
- **Variant changes are gated.** A material patched after it already has a shader (a house's glass
  between day and night, a side flipped) is noted by `compileGateMaterial`. On the next gate pass,
  what uses it goes through the gate again. The night-window patch no longer declares `kbNight`
  twice, which made a variant of its own.
- **Parked cars give the same answer.** `vehicleAt` returns the same object for a car still parked
  where it was, instead of a new one every scan.
