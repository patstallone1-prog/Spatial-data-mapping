# Crashes, a clock that can be held, leaves as leaves (2026-11-23)

Six things asked for in one pass: a way to stop the game's clock for testing, crashes that leave
marks and are cleared by an ambulance and a tow truck, people hit as people are hit, fallen leaves
as leaves, walkers who finish a crossing, and the pale triangles in the yard at Marina Middle
School found by looking, not guessed at.

## The clock held (`docs/city/clock.mjs`, the Time panel)

Only in the offline practice game: the city online keeps one clock for everyone.

- **Time** on the top bar: *Hold now*, or hold at an hour (06:00, 08:00, 12:00, 15:00, 17:30,
  21:00, 02:00: the next time the game's day comes to it), and *Let time run*. From the console:
  `kerbsideCity().time.hold(8)`, `.release()`, `.state()`.
- Held, the game's time stands still: the sun, shops' hours, pay, rent and bills. `clockTime()` is
  what every reader of the game's time goes through (the city, its books, the sky, the kitchen's
  tickets). Let go, it runs on from where it stood. A held clock stays held across a reload.
- The street does not stop. Each resident, with their car, lives the next six real minutes from
  the held moment over and over, on one of 48 phases of that window (by their id), so the people
  out at any moment are spread evenly over the whole window: as many walking, driving, waiting and
  working as that stretch of the day has, for as long as it is held. Someone whose window comes
  round while they are in your sight goes on with their day until they are out of it. Lights and
  the traffic's rules keep real time.
- Measured on the Marina, held at 08:00, four seconds apart for three minutes: 225 to 260 people
  out, 362 to 453 cars (61 to 105 visitors' cars moving, 10 to 23 commuters', 5 to 14 residents').
  The first minute and a half after holding at an hour of the next day is the district's day being
  planned: the street fills as it is.

## Crashes (`docs/city/crash.mjs`, `docs/city/crash-scene.mjs`)

- **Marks on a car, by the speed of the blow.** Under 0.8 m/s nothing; to 3.5 m/s the paint is
  scraped where it rubbed; to 7 m/s that panel is dented; over that the end that took it is pushed
  in, up to 0.95 m at 20 m/s, more on the side the blow came from, the bonnet kinked along the
  fold. A side is dished in round the point struck. `impactZone` reads where it landed in the car's
  own frame; `crumple` moves the body's corners (the same corner the same way in every part, so no
  cracks open); `scuff` is the darkened and scraped paint laid over it. A damaged car is drawn on
  its own, not as one of the instanced traffic.
- **The city's cars.** A hard crash stands where it stopped until it is cleared; a bump the books
  never hear of is marked while the car is about and gone when it has left your sight. Cleared, a
  car is as new and stood at the nearest mechanic's kerb until its owner next has it out
  (`CityWorld.clearCrash`, command `crash_cleared`).
- **Your own cars** keep what a crash did to them: the shape, the marks, the condition, and a top
  speed down to 45% with the front right in. Nothing takes one to a body shop for you any more: a
  body repair at a mechanic's (the existing work order, "fender") makes it whole. Driving into a
  wall or a pole marks the end that hit.
- **Routed round.** A wreck, and whatever has come for it, is in the traffic's way like your car
  is: gone round. The block it is on is known shut to drivers who have not turned into it, who
  take another street (the existing jam re-routing), for as long as a wreck stands there.
- **Cleared up.** Someone rings after five seconds. An ambulance comes for anyone hurt badly
  enough for hospital: it pulls up behind the crash in its lane, two crew go to each casualty with
  a stretcher, lower it, lift them on, carry them to the doors and in (13 s each), and it drives
  off. A tow truck comes for each wreck: it stops just past it, the boom comes down, the cable is
  run out and hooked, the near end is lifted and the car drawn up behind (15 s), and it is towed
  away. Walk or drive 150 m off with it out of sight for 12 s and it is cleared at once, unseen.
- **Someone on foot.** Under 4.5 m/s they are knocked down in front of the car and it goes over
  where they lie; to 11 m/s they are folded onto the bonnet and carried until the car has stopped,
  then off its front; faster they are thrown. Hurt badly, they lie where that left them until the
  ambulance has them.

Seen in the browser: a staged 17 m/s crash (a sedan's front pushed in, a hatchback's side dished),
the ambulance pulling up behind it and leaving with both drivers. The tow truck was seen arriving;
its first approach came from across the road and sat in a queue, which is why it now comes up
behind the wreck in its own lane and pulls out round a queue.

## Leaves (`docs/leaf-litter.mjs`)

The flat patches of leaf texture under park trees are gone (the headset keeps them). Round the
walker, under every tree drawn in full, each leaf is a small folded blade: about nine a square
metre under the crown and thinning to nothing at 1.7 crown radii, 55% of them in heaps of 7 to 26
(leaves lying on leaves), the rest singly. Palms drop none, conifers a few.

- The wind at the ground comes in gusts, less than the sky's. A leaf lying still is shifted when a
  gust passes its own mark (1.3 to 3.2 m/s; more for one with others on it), slides and tumbles,
  hops in a strong gust, and stops when the gust falls. Each has its own turn of the air, so a
  heap blown out is a scatter.
- A foot going through takes the leaves within 0.42 m with it and kicks them up off the heap.
- A leaf is never inside a building and never past a fence line (a chain link's mesh or a picket
  gap is smaller than a leaf); it goes through a gate, which is a gap. A move into a wall is tried
  along each axis alone, so it slides along the wall or stops against it.

## Walkers

- A street with an island or a median in it is crossed in one go. Its two crossings, one a
  carriageway, were each waited at on their own: a walker set out, reached the island (or stood
  short of it, in the first carriageway: the place to wait is a pace or few back from a crossing)
  and stood there. Two crossings on one line within 9 m are one, waited for once, on the
  pavement, for long enough to walk the whole of it (`City.joinDivided`: 401 joined on the Marina).
- Nobody waits in a roadway: not on a crossing already begun, not a step short of the next one
  where that step is in the last one's roadway, and not anywhere else the roadway test says is
  road.
- Beside a median the pavement looked for is the far kerb's, over the lane, not "none".
- A stretch of roadway no pavement could be found for is waited at for a gap, like a crossing.
- Measured (walk positions over a game day): on a roadway and on no crossing, 3.3% before this
  pass's last two rules and 2.6% after, in a smaller sample. Not zero.

## The yard at Marina Middle School

Looked at from above in the browser: pale right triangles, 5 to 10 m, along both sides of the
striped lot in the school yard. Each mesh was hidden in turn and the pixel read: it was the bare
terrain showing through holes in the yard's paving. `recutGroundOffRoads` took paving off a car
park by dropping whole triangles whose middle and two corners were in the lot; where a triangle
straddled the lot's outline the part outside went too. `cutCoverOffLots` now cuts each triangle
along the outline and keeps what is outside (exactly, for a lot drawn as its rectangle; by halving
to half a metre for one with a dent in its outline). The same view afterwards has none, and two
other car parks were looked at for anything new.

(The last pass's change -- stall lines in metre lengths -- was a guess at this and was not the
cause.)
