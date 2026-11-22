# 57 · Animals: what is built

2026-11-22. The plan is [56](56-animals-plan.md). This is the part of it that now runs.

## What you can do

- **K** opens **Pets**: each pet's health and hunger, feeding it from what you carry, where it is
  to be, the vet when you stand at one, and taking a new one in.
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

## Detail by distance

| | full | moderate | low | not drawn past |
| --- | --- | --- | --- | --- |
| dog | to 30 m, about 9,700 triangles | to 75 m, 1,500 | to 190 m, 370 | 190 m |
| cat | to 22 m | to 55 m | to 140 m | 140 m |
| rabbit | to 18 m | to 45 m | to 110 m | 110 m |
| pigeon, crow, gull | never | to 35-45 m, about 60 | to 150-260 m, 26 | |
| sparrow, rat | never | never | to 45-55 m | |

At most 24 animals are drawn in full, 120 at moderate, 260 at low; 300 birds; 24 rats.

## What it is not

- The animals are **modelled here** from lofted shapes to each breed's proportions: jointed,
  two-coloured, with a gait. They are not scans or licensed models and do not look photographic.
- Not built from the plan: fish, sharks and porpoises; coyotes; licences, the leash law and
  fines; neglect reports; pet insurance; other players seeing your pet; fetch; shelters.
- A pet in the car is not drawn on the seat.

## Files

`docs/city/animals.mjs` (the species, the record, how a pet moves, the residents, the field, the
world's commands), `animal-figures.mjs` (drawing), `animals-view.mjs` (the page), 
`animals-sheet.html` (every animal, for looking at), `tests/city_animals.test.mjs`.
