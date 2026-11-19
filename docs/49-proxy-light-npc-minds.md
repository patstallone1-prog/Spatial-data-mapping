# 49. Shadows and bounced light from a stand-in, people with minds of their own, and what is next

2026-11-18. Two things built, and a plan for the rest of the list (how the large open-world
games fit their detail into a console, applied to Kerbside).

## Built: the sun's shadows, the sky seen, the light thrown back

`docs/proxy-light.mjs`, hooked into every lit material by module 02 (`PROXY_LIGHT.patch`).

The page had no shadows. A shadow map would draw every building, tree and kerb again from the
sun each frame; this does not. It keeps a **stand-in** for the world near you, drawn from
straight above now and then: at each point how high the top of the world is, and its colour
(1024 x 1024 over 720 m on foot: 0.7 m a texel; 1.4 and 2.9 km as the view pulls out). Each time
the sun has moved a third of a degree, two small GPU passes trace the sun through it:

| kept a texel | what it is |
| --- | --- |
| the shadow's top | the height below which the sun is cut off |
| the sky seen | how much sky a point at street level looks up at |
| the surface's height | to fade both with height above the street |
| the light thrown back (256 x 256) | sunlight off the ground and the sun-facing fronts near by, by colour |

A lit material reads two textures a pixel and that is the whole cost at draw time. This is
Unreal's Lumen cut down to what a tab can carry: Lumen traces a simplified copy of the scene and
keeps the light on a low-detail cache of its surfaces; here the copy is one height and one colour
a point, and there is one bounce.

What moves is left out of the stand-in (it is not drawn every frame); cars and the people near
you get a soft patch of dark where they meet the ground instead (`view.mjs`, `shadeAt`).

Measured (headless Chrome, Metal, the Marina City build):

- memory: 17 MiB on the GPU, nothing in the page's heap;
- frame: the same with it on and with it off -- 60 fps with some 700 people in sight, 51-57 fps
  with 2,300 (the crowd, not the light: on and off, and the ground patches shown and hidden,
  measured alike);
- the stand-in is drawn again when you have moved 115 m, when more of the world has arrived, or
  every two minutes: 11-31 ms of the page's time each (about 100 ms the first time, while the
  loading screen is still up). The sun's trace is under a millisecond of the page's time.

Known limits, by design:

- one height a point: a bridge shadows everything under it, an arcade is solid;
- shadow edges are soft to about a metre; a lamp post's shadow is a smear, a wire has none;
- inside a building it is switched off (a room under its roof would be in the dark);
- off in the headset; a browser without float render targets gets no shadows and says so;
- the bounce's colour comes from above, so a front throws back a mix of its roof's colour and grey.

Switch: `kerbsideProxyLight().setEnabled(false)`; the numbers are `PROXY` in the module.

## Built: near you, people decide; far off, they keep their day

`docs/city/temperament.mjs`, used by `fleet.mjs` (Drivers) and `view.mjs` (frameCity).

The rings were already there (detail.mjs; SIM_M): cars within 240 m are driven by the rules,
people in the full and moderate rings are placed every frame, and everyone beyond is where their
day has them: a start, an end, the time between. That far ring is unchanged and stays fixed.

New for the near ring: each person has a **temperament** -- nerve, temper, patience, care,
civic -- the same every time (from their id, tilted by age and work).

- **Driving** (`drivingStyle`): the pace they hold (86-100% of their cruising speed, never over
  the limit), the room they leave (0.8-1.6 of the usual headway), how long they sit behind
  something before going round it, and how far ahead they brake for someone in the road.
- **A car coming across** (yours, a bus pulling out, a bicycle): every driver now looks two and a
  half seconds along both ways; where they would meet, they brake as hard as it takes. The
  assertive, all but there already, go through.
- **On foot**: someone steps clear of a car that is not stopping for them -- the timid 2.3 s
  ahead, the bold 0.9 s -- and at a crash or a fight each does their own thing: runs, watches,
  films it, telephones, or goes to help. At one incident at most 3 help, 3 telephone and 6 film.

Checked live in the Marina: a staged crash with 129 people within 25 m -- 3 went to help,
3 telephoned, 6 filmed, 11 ran, 16 watched, and the other 90 walked on.

Not done: a 911 call does not send a patrol car (the server already counts witnesses near a
strike or a collision); drivers brake but do not swerve for a car coming across; the far ring
does not react to anything, by design.

## Second pass, 2026-11-19: the rest of the list

### Drivers (the part that mattered most)

Measured on the real Marina in node (the page's own streets, places and people dumped from a
running page; `Drivers` driven as view.mjs drives it), then on the page.

What was wrong, in order of size:

1. **Cars came into sight already crashing.** A car entering the simulated area was put where
   its day had it at cruising speed, whatever stood there: its first step drove it into the back
   of a queue at 12 m/s. That was a crash; the wreck stood in the lane for the rest of its trip;
   the next car in did the same. 85 of 87 crashes in six minutes were this. Now a car comes in
   at a speed it can stop from in the room it has.
2. **A wreck stood for good.** Two cars that had hit never moved again while they were in
   sight. Now they stand 30 s after a bump, two minutes after a hard one, and drive on.
3. **No hard braking for a car.** A driver braked at 3.2 m/s2 for the car ahead however
   suddenly it stopped; the 8.5 m/s2 was kept for people. Now as hard as it takes.
4. **A car facing the wrong way in the lane was not seen at all** (only cars going the same
   way were). Now stopped for, and gone round if it stands.
5. **Crossing cars**: of two whose ways cross, the one that would drive into the other's side
   gives way (yours and the buses already were).
6. **Too many cars.** The through traffic is a day's worth and the game's day is 72 minutes:
   driven all at once it is twenty times what the streets carry -- 640 cars in sight, one in
   five moving, on main as much as here. Now 14% of the visitors' trips are driven where you
   can see them (the same ones every time); the residents' own all are.
7. **Cost.** Every car looked at every person every frame (268 x 1,300), and a late car looked
   for somewhere to be put a dozen times a frame. People are now found by square, and the
   looking is once a second.

| the real Marina, node, 5-6 minutes | main | now |
| --- | --- | --- |
| crashes between the city's cars, real-time density (86 cars) | 87 | 5 |
| crashes at the page's density, all through traffic (530-650 cars) | 1,496 | 58 |
| ... with the through traffic thinned to 20% (163 cars, no one on foot) | -- | 13 |
| cars stood over a minute (86 cars) | 56 | 10 |
| a wreck or a frozen car in the lane: cars that drove through it | -- | 0 |
| ... cars that hit it or piled in behind (three runs) | -- | 0, 1, 3 |

On the page (headless Chrome, Marina, about 1,100 people in sight): 141 cars driven, **1 crash
in 90 s**, the traffic step 4.6 ms a frame (it was 20-25 ms with the crowd out), 58.6 fps.

Still true: the harness has people walking out without waiting at the kerb, so its counts of
people hit are too high and are not quoted; on the page 2 were run down in two minutes before
the thinning and none in the 90 s after. Queues still clear some knots by putting a car on
past them (19 in 90 s).

### Lighting

- **Street lamps**: every lamp head (SFPUC's layer, module 21) throws a pool of warm light at
  night on the street and the foot of the fronts, from one more small picture in the same square.
- **Parked cars** are in the stand-in and cast shadows (view.mjs shows them alone while it is drawn).
- **Dappled light**: where the shade is a tree's (the stand-in is green there), patches of sun.
- **In slices**: the stand-in is drawn a quarter a frame, each quarter through a camera that
  sees only that quarter: about 10 ms of the page's time a frame for four frames, not 11-31 at once.

### People

- **Clips** (`docs/city/clips.mjs`, written by a subagent, wired into drawPeople): the near ring
  walks, strolls, jogs and runs with cadence matched to speed, leans, turns its head; stands
  idle, waits at a kerb looking each way, telephones, films, watches, helps. Keyframed poses
  for the rig as it is (no knees or elbows): not retargeted motion capture, which needs skinned
  bodies and licensed clips.
- **A patrol car answers a 911 call**: from a few blocks off by the streets, round a queue if
  held, to the kerb beside it; stands 30 s; drives on. (Checked: 284 m in about 40 s.)
- **Rain**: drivers near you hold 90% of their pace with a quarter more room; nobody takes a
  break outside.
- **Streaming ahead**: the fronts' photographs are fetched four seconds ahead of the way you
  are going (120 m at most) and let go sooner behind.

### Off Chromium: built and measured (`desktop-webkit/`, by a subagent)

A 240 KB macOS app on the system's WebKit (the Electron one is 289 MB). Two five-minute runs of
the live site (before this pull request), City mode; reports in `desktop-webkit/reports/`.

| | WebKit shell |
| --- | --- |
| app on disk | 240 KB |
| website data after a cold load | 191 MB, nearly all HTTP cache; 1.5 MB of site data |
| lobby / in the city, cold | 1.1 s / 145 s (warm 136 s: loading is compute, not network) |
| page memory: peak / steady in the city | about 10 GB / 5.8-7.4 GB (of which only 2.9-3.9 GB resident: the rest compressed or swapped) |
| GPU process | about 650 MB |
| **frames a second in the city** | **4.7** |
| processes killed or reloaded | 0 |

Where it spikes: **the people and the traffic arriving** (+4.7 GB in four seconds, falling back
3-4 GB within ten); "Loading the Marina" (steps of 0.7-1.25 GB over 70 s); tree pits (+0.9 GB).

What it means: WebKit removes the 4 GiB ceiling and the 289 MB, but **it is not usable yet**:
4.7 fps with the page's main thread mostly idle (frames are waiting on the GPU process;
why was not profiled), and with no `performance.memory` the page's memory governor never runs,
so it grows until the machine swaps. The Electron app stays the one to use.

What to optimise, from the numbers: (1) find the WebKit frame time (blocking WebGL calls to
its GPU process: likely the per-frame instanced buffer updates and 1,000 draw calls); (2) the
arrival burst, spread over frames; (3) a governor that counts its own bytes; (4) the Marina
load; (5) typed arrays kept after upload (0.9-1.2 GB).

### Not done

- **The simulation in a worker.** Not built. The WebKit run measured the page's process at
  38-48% of one core in the city with frames waiting elsewhere, and the traffic step is now
  4.6 ms: a worker would not have bought frames, and it is a rewrite of how view.mjs reads the
  city every frame. It remains the way to take the simulation's memory out of the page's heap.
- **Merging far blocks into one mesh** (the other half of streaming).
- **Retargeted motion capture** (see Clips).
- Drivers brake and go round what stands; they do not swerve round what moves.

## The plan as it was written on 2026-11-18

In the order I would do them.

1. **Getting off Chromium (lowest effort first).**
   - *A system-WebKit shell* (Tauri 2, or a hundred lines of Swift round WKWebView): the same
     site, no bundled Chromium (the app is a few MB, not 250), no V8 4 GiB pointer-compression
     cap. Days, not weeks. Unknown until measured: WebKit's own per-process memory ceiling, and
     whether the page's WebGL2 and its memory governor (which reads `performance.memory`, a
     Chrome-only number) behave. First step is the measuring build.
   - *The simulation in a worker.* The traffic and the people (fleet.mjs, people.mjs: no DOM, no
     three.js) run in a Web Worker with a heap of its own; the page keeps the drawing. That takes
     the largest non-GPU load off the frame and off the 4 GiB heap in every browser and in the
     desktop app as it is. One to two weeks; the server already runs the same modules headless.
   - *A native engine* (the Unreal plugin in `unreal/`, or Panda3D or Godot) is the only route
     with no ceiling but the hardware, and it is a rewrite of the renderer and every panel:
     months. Not recommended before the two above have been measured.
2. **Streaming ahead of you.** The rings already reach further the way you are going; the tiles
   and facade pictures do not. Fetch along the route ahead, drop behind, and merge what is far
   into one mesh a block.
3. **Bodies and animation.** The near ring swings its limbs by formula. Retargeted clips (walk,
   run, phone, carry, sit) on the avatar builder's bodies for the full ring only; the moderate
   and low rings stay as they are.
4. **Lighting, next.** Street lamps as pools of light at night from the same map; parked cars in
   the stand-in; dappled light under trees; the stand-in drawn in slices so no frame pays for it.
5. **Minds, next.** A patrol sent to a 911 call; drivers that swerve as well as brake; errands
   that change with the weather.
