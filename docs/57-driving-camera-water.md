# 57 · Driving, the magic camera, and going into the water

Three changes to how you move through the living city (City mode).

## Getting in and out of a car

The code is `docs/city/car-entry.mjs` (pure), and `view.mjs` `enterCar`, `exitCar`, `stepEntry`
and `afterPose`.

### Getting in (Enter by your car)

1. You walk to the driver's door, on the left. From the other side of the car you walk round its
   nearer end, not through it.
2. You turn with your back to the seat.
3. You go down onto the seat, in through the door as the hips drop. The thighs bend forward and
   the knees bend back, so the shins hang.
4. You swing your legs in, turning to face the front.

The car you walked up to is the car you drive: its body is kept, not swapped for a new one.

### Getting out

You can only get out once the car has nearly stopped (under 1.2 m/s). Getting out reverses the
sequence:

1. Legs out.
2. Up off the seat, leaning forward to stand.
3. A step away from the door.

You get out of the driver's door. If something stands there (a parked car), you use the other
side. The car stays where it stopped, as your parked car.

## Driving

The code is `docs/city/car-control.mjs` (pure); `view.mjs` `drive` moves the car by it.

### Pedals and wheel

The arrows are the pedals and the wheel, as a car has them:

- **A pedal goes down the longer it is held** and comes up when let go.
- **Throttle.** It pulls hard from rest and less with speed (a = min(accel0, power / v)). That is
  about nine seconds from rest to 60 mph.
- **Off the throttle,** the car slows by itself from rolling resistance, air drag and the engine.
- **The brake** bites harder the longer it is held: from a touch, 1.4 m/s², to full, 8.3 m/s².
- **Reverse.** Held at a standstill, the brake puts the car into reverse; Up brakes the reverse
  and drives on.
- **The wheel** turns while Left or Right is held, and comes back by itself.

The curve the wheel takes is as tight as the lock allows at a crawl (about a 4 m radius). At
speed it is as wide as the tyres' grip needs (radius v² / 5.5 m/s²), so 45 mph turns on 70 m and
more.

### Helpers

Each helper is one key. Any arrow takes the car back from a helper.

- **A / D: change lane.** The car moves one lane (3.2 m) to the left or right on a smooth S curve,
  taking 2.2–3.8 s depending on speed. The heading turns toward the new lane and back, and the car
  ends facing the way it went. It needs at least 2 m/s. On a street with one lane each way it
  still goes, with a warning about the kerb and oncoming cars.
- **S: stop.** The car brakes just hard enough to stand at the stop line of the light ahead, if
  that light is red or amber. The light is read the way the city's own cars read it (`fleet.mjs`
  `signalAt`, `Drivers.stopLine`). With no light ahead, it makes a comfortable 2.6 m/s² stop. The
  HUD shows the light ahead and how far its line is.
- **P: park.** The car parks in the nearest free place:
  - a car park stall within 28 m, nosed in;
  - otherwise a stretch of kerb on the right ahead where a car may stand: no driveway, no red or
    blue paint (`kerbParking`), and nobody already there.

  It drives a smooth path into the space at a walking pace, backing in when the space is behind.
  With no free space it pulls up where it is: any empty road, or open ground.

The HUD shows the gear (D, R, P) and the helper at work.

## The magic camera

The code is page module `32-the-magic-camera.js`; it hooks into `placeCamera` (module 21) and
`walkSteer` (module 26).

In City mode the view looks after itself:

- **It follows your turns.** It comes round behind you as you turn, faster the further you have
  turned from it. Turned right round, it swings behind you in about a second, so you are not left
  walking toward the camera.
- **It looks ahead.** It aims a little ahead of you: 0.3 s of your way, up to 5 m.
- **It pulls back at speed.** In the car it stands up to 30% further back as you speed up.
- **It sees past buildings.** Coming up to a building that would be between it and you, it tries
  the smallest change that clears it: round to one side up to 1 rad, or up 0.3 rad. It keeps to
  the side it already went round by, and comes back once there is room.
- **It never ends up inside a building.** Where nothing clears the building, or you dragged the
  view there yourself, the camera keeps going round rather than being shoved in toward you or up
  overhead. It stands outside the building's far wall, so you see that building's side and never
  its rooms. You are drawn through the wall as a light-blue outline: your figure, or your car.
- **Dragging is yours.** A drag takes over: what the camera had turned by itself becomes the view
  you asked for, so it does not jump, and it is left alone for about two seconds after.

Explore mode, the walker's-eyes view and the headset keep the view as before. In those, a
building lifts the camera over it, and only against a tower is it pulled in.

## Into the water

The code is page module `33-into-the-water.js`; `core.mjs` `swimMode` and `applyExertion`;
`view.mjs` `swim` and `afterPose`; and the server's exert guard.

### Wading and swimming

In City mode, on foot, you can walk into the water. The car is still kept out of it; on the map,
nobody walks on water.

- **Wading.** In the shallows the feet stay on the bottom, so the water covers you as far as the
  bottom is under its surface. Wading slows you, more the deeper it is.
- **Swimming.** Deeper than 1.3 m, you swim. The body lies forward in the water, hips just under
  the surface, head up. The stroke is a front crawl: each arm back over the water and forward
  past the head, then pulled under the body to the hip, with the legs fluttering.
  - **Swim:** 1.0 m/s, costing 0.05 stamina a second.
  - **Swim fast:** hold Shift for 1.9 m/s, costing 1.1 a second.
- **Treading water.** When stamina falls under 15, or you stop moving, you come upright and tread
  water: the arms scull out to the sides, the legs pedal, and only your head is out of the water.
  This gets your stamina back at 0.45 a second. Out of breath, you go no faster than 0.3 m/s and
  stay treading until stamina is back to 35. Then you swim on.

### Stamina

Stamina is counted as you go and reported to the city's books with the walk (`exert`:
`swim_s`, `swim_sprint_s`, `tread_s`). The server holds each of these to the time the report
covers.

### How deep the water is

The map has no soundings, so depth comes from how far it is to dry ground and what that ground is:

- **A beach** shelves 7 cm down for every metre out.
- **A sea wall or a pier** (ground 0.7 m or more over the water, or built ground) drops to 1.8 m
  at its foot.
- **A pond** the map closes in reaches about 1.6 m at its middle.
- **A fountain's basin** is 45 cm at most.

Where the drawn ground under the water is lower than this model, the lower of the two is used.
