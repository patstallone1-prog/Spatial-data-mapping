# 57 · Animals: what is built

2026-11-22. The plan is [56](56-animals-plan.md). This is the part of it that now runs.

## What you can do

- **Your profile, Relationships › Family** (it was K's Pets panel): each pet's health and hunger,
  how lonely it is, feeding it from what you carry, where it is to be, the vet when you stand at
  one, and taking a new one in.
- **Take one in** at a pet shop or a vet's for the fee (dog 180, cat 120, rabbit 70), or through
  the same panel anywhere for a quarter more: brought to you. Four at most.
- **Food**: dog food, cat food and treats are on the shelves of the Marina's pet shops, vets and
  grocers, and in the online store. A bag feeds six times.
- **L** by your pet: it stays where it is -- tied up, if you carry a lead (pet shops sell them).
  **L** again and it follows.
- **The car**: a pet that is following comes to the door and is in about two and a half seconds
  after you. Drive off sooner and it waits where it was. **L** at the wheel before it is in tells
  it to wait; **L** at the wheel with it aboard leaves it in the car when you get out; **L**
  beside the car lets it out.
- A pet **keeps out of walls**, goes round what is in its way, **waits at the kerb** when a car
  is coming and you are not in the road, **growls** (a cat hisses) at a car bearing down or a
  fight, and gets out of the car's line -- sideways, not ahead of it.
- **Hurt**: a car that hits it (yours or the city's) injures it by its speed; the city's drivers
  stop for it as they do for someone in the road. A small hurt mends with food and rest; a
  serious one does not, and gets worse. **The vet** (open Pets at a vet's surgery) treats it for
  a quoted price.
- **Death**: of hunger left long enough, of a serious injury untreated, or outright under a car
  at speed. It is told to you with the cause; "Lay to rest" clears the record.
- Time passes for a pet **only while you are about** (three game hours at most between two
  looks): a week away is not a week unfed.

## What else is about

- **Dogs on leads** with one in six of the city's people out for a walk; **cats on stoops** in
  front of one home in nine for part of the day (in at night, in the rain, and when a dog or a
  runner comes by).
- **Pigeons, sparrows, crows and gulls** from a seeded field of 48 m cells: more by cafés, gulls
  by the water. Ground birds peck about, and go up, round and down when you, a dog or a car
  come close. **Rats** by night near eating places, along a bit of kerb and back.
- **Flocks going over.** By day, pigeons, gulls and crows cross the district on straight ways
  of their own, 520 m long, 16-55 m up, each flock again every 4-10 minutes. Six in ten fly along
  the wind (with it or into it), the rest any way; a new set of ways every three game hours.
  Seen from the street that is about 1.7 flocks over an hour of game time inland and 2.3 by the
  water, within 150 m (`ambientCell` `pass`, `birdAt` `passAt`).
- **Birds up on the street lights.** Pigeons (by cafés most), a crow or two, and gulls by the
  water sit on the arm over a lamp (up to four) or on a pole's top (one). Only on a street
  light the map has: module 21 `streetPerchAdd` records each one, and module 30 `perches` hands
  them, the attached region's too, to the city. A flock with no light in its cell is not drawn.
  A sitting bird faces into the wind and looks about.
- **Flying to the wind.** The wind is the sky's (`globalThis.kerbsideWind`). A flying bird faces
  the way it goes through the air, so it crabs into a crosswind (`flightIn`). Its speed over the
  ground is its air speed with the wind behind it, less the wind against it. It flaps harder
  into a headwind and climbing, less with the wind behind, and glides coming down: wings held
  out a little above level. Each kind flies its own way (`FLIGHT`): a gull mostly glides (3
  beats a second when it flaps), a pigeon beats hard (7) and glides between bursts, a crow rows
  steadily (4), a sparrow bounds (10).

## Detail by distance

| | full | moderate | low | not drawn past |
| --- | --- | --- | --- | --- |
| dog | to 30 m, about 9,700 triangles | to 75 m, 1,500 | to 190 m, 370 | 190 m |
| cat | to 22 m | to 55 m | to 140 m | 140 m |
| rabbit | to 18 m | to 45 m | to 110 m | 110 m |
| pigeon, crow, gull | never | to 35-45 m, its model: 300-480 stood, 350-530 flying | to 150-260 m, its far model, about 100 | |
| sparrow | never | to 12 m, its model | to 55 m, its far model | |
| rat | never | never | to 45 m | |

At most 24 animals are drawn in full, 120 at moderate, 260 at low; 300 birds; 24 rats.

## The birds' models

The pigeon, gull, crow and sparrow are imported models: low-poly birds from Poly by Google and
the Google Data Arts Team, CC-BY 3.0, credited in `docs/city/models/birds/birds.json` and
`License.txt`. They were made ready in Blender by `tools/blender/build_city_birds.py`:

- **Colours.** Each model's texture is baked to one colour a face. The models are shaded smooth
  across gentle folds and kept sharp at creases.
- **Size and facing.** Each is turned to face -z and scaled to the species' own length and span
  (`SPECIES`). A standing bird has its origin at its feet, so it stands on the ground or a lamp
  arm.
- **Recolouring.**
  - The dove is a rock pigeon: a slate head, a neck that turns from green to purple with the
    feathers' angle, a grey body with wing bars, and a dark band across the tail.
  - The gull is a western gull, with a dark slate mantle and black wing tips.
- **Flying.** The flying seagull flies for the gull, and for the pigeon (its wings broadened and
  recoloured). The flying raven flies for the crow, and for the sparrow (recoloured brown and buff).
- **Wings.** Each flying bird's wings are cut off at the shoulder and held level. In the page
  each wing beats on its own hinge as the flight asks (`FLIGHT`): a gull's slow beat, a sparrow's
  quick one. A gliding bird holds its wings a little above level.
- **Far tier.** Each bird also has a far shape, decimated to about 90 triangles stood and 120
  flying.

The files are four, one a species: 40 to 78 KB each, 228 KB in all. A species' file is fetched the
first time one is drawn, and the modelled bird stands in until it arrives, or if it does not
(`birdModels()` says which). A species' parts with nothing drawn are left out of the frame.

## What it is not

- The dogs, cats and rabbits are **modelled here** from lofted shapes to each breed's
  proportions: jointed, two-coloured, with a gait. They are not scans or licensed models and do
  not look photographic. The birds are low-poly models, meant to be seen from a little way off.
- Not built from the plan: fish, sharks and porpoises; coyotes; licences, the leash law and
  fines; neglect reports; pet insurance; other players seeing your pet; fetch; shelters.
- A pet in the car is not drawn on the seat.

## Files

`docs/city/animals.mjs` (the species, the record, how a pet moves, the residents, the field, the
world's commands), `animal-figures.mjs` (drawing), `animals-view.mjs` (the page),
`models/birds/` (the birds' models and their credits; `tools/blender/build_city_birds.py` builds
them), 
`animals-sheet.html` (every animal, for looking at), `tests/city_animals.test.mjs`.
