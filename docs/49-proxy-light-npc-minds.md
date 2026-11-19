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

## Planned: the rest of the list

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
