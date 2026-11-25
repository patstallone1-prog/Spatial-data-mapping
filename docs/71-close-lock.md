# 71 — The close lock, the ground ahead, and grey glass

The reality lock (PR #229, `detail.mjs` `lockedForm`) keeps a thing's *drawing* from changing while
you look at it. The close lock keeps the thing itself honest near you: inside the full-detail ring
(82 m for people, 100 m for cars and bicycles, measured straight from you, not stretched by where
you look) people, riders and cars move only as they could.

Code: `docs/city/close-lock.mjs` (`closeLock`, `feetTracker`, `groundAhead`, `byWall`), applied in
`docs/city/view.mjs` `frameCity` (`peopleLock`, `carsLock`, `feetNear`). Tests:
`tests/close_lock.test.mjs`.

## Nothing appears, vanishes or catches up

- **Taken up at the outer rings.** Everyone is tracked out to the low ring and drawn from the
  moderate ring in, as before. One the city would put down *inside* the close ring is withheld (not
  drawn) unless it comes out of somewhere it could have been all along: a door or wall within
  1.6 m, a car beside it, a bus or cab, or a shop you can see into. It is drawn once its day has it
  out past the ring, and comes back in the usual way.
- **Nothing vanishes.** One whose day takes it indoors, into a car or off the list becomes a
  "ghost": it finishes its own walk (to its door, or back round to where its round began) and is
  gone only at a door or wall. Anywhere else it stays, standing, until it is out past the ring.
- **Nothing catches up.** One behind its day (held at a kerb, stuck behind a van, put back by a
  crowd) goes on at its own pace, at most 10% brisker, from where it is. The time it is behind
  is its walk's own (`fleet.mjs` `walkLags`, `holdWalk(…, most)`): its walk waits for it, so its
  day has it along its own way, round corners, not through them. A walker well behind (more than
  2 m along its way), or whose day has moved on to another walk, follows its own way there.
  Out past the ring the debt is dropped (`release`) and its day has it again.
- **Stuck.** One walking into a wall for 1.5 s goes in there, if it is a wall it can go into;
  otherwise it stands.
- **One drawn far whose day jumps near you** walks in from where it was; it is not set down by you.
- **Last word.** After everything else that moves people and cars in a frame (keeping apart,
  clumps, shop floors, strides), `settle` puts anyone close by more than 0.75 m from where the lock
  had them back there. Separately, nobody inside the ring is drawn further from last frame than
  they could have gone, whatever moved them.
- **In sight or not.** With the clock held, someone drawn close by keeps their turn of the day
  (`holdInSight`) even when they are behind you, so their day is not restarted under them.
- **Scene cuts.** The city first built round you, a jump of yours over 40 m, or a gap of 2.5 s
  between frames is taken as it is.

Counters: `kerbsideCity().detail().lock.close` — `people`/`cars` {withheld, ghosts, held,
admitted, cuts, jumpsNear (frames held over 3 m behind), wentIn, settled, jumpsStopped},
`feet` {reads, looks, rough, fine}, and `behind` (the furthest behind now). `peopleNow(true)` adds
whether each one stands at a door.

### Measured (headless Chrome, Marina, clock held at 13:00, 2026-11-25)

Three 60 s windows after a 2 min warm-up, about 430 k person-frames and 1.6 M car-frames within
range: every person appearing or vanishing within 70 m did so at a door; no person moved more than
1.13 m in a frame (the first steps out of a doorway); no city car jumped; one visitor car flickered
once at 82 m. Reality-lock form changes near you: 0.

## The ground ahead

In the close ring each walker's way ahead is looked along for ten feet (3.048 m, every 0.25 m) each
half metre they go or 0.4 s. Where the ground there differs by more than 4 mm, the ground under them
is read again every 4 mm they move instead of every 10 cm, so a foot is never set below a kerb's
edge or a slope it has walked onto. Bicycles and cars at full detail stand on the same readings.
In the Marina nearly all ground is "rough" by that measure, so close-by walkers read the ground
about every frame: at 5.6 µs a read, about 0.2 ms a frame for 25 people.

## Glass

`realGlass` (page module 02) panes are now visible: face opacity 0.2 (was 0.05; the old
MeshPhysical glass was 0.42 blue-green), edges 0.68, reflection 0.16, and the colour pulled 60%
toward a neutral grey `#8c9295` — a slight grey sheen between the two looks.
