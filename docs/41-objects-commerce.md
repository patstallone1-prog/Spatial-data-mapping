# 41 · Objects, physical commerce and believable outcomes (2026-11-14)

This pass covers the object lab of 2026-11-13 (`~/Documents/Kerbside-object-lab-2026-11-13`):
its 436-model library and the plan in it, *Objects, interactions and resale*, in its three
sections. It also covers the NPC bodies and the holes in the cars.

## 1 · Recognisable objects

- **Build.** `scripts/build_city_objects.mjs` builds the models from the lab's `library.json` and
  `inventory-coverage.json`. The output goes to `docs/city/models/objects/`: 134 GLBs, 3.6 MB.
  - Each model has a `near` and a `far` node sharing one set of WebP textures, 256 px at most.
  - Geometry is meshopt-compressed; `near` is capped at 3,500 triangles.
  - Every model is CC0 (Kenney, Poly Haven, Poly Pizza) and credited in `docs/city/objects.json`.
- **Coverage.** 138 of the 256 shop items are drawn with a model.
  - The lab's statuses are kept. `generic_match` and `representative` use the model as it is.
  - `label_required` items take the product's colour, e.g. a can family tinted per brand.
  - `reference_only` and gap items keep the page's own drawn shape. A model of a different
    thing is not used.
  - About 30 dishes and packs are composed from the lab's parts: a plate with a burger and
    fries, six cans, crushed cans as scrap metal, a bowl of noodles, a box of eggs.
- **Drawing** (`docs/city/objects.mjs`).
  - Each thing is sized to the catalogue's `length_m`.
  - Detail is chosen by size on screen: near over 160 px, far over 48 px, nothing under 5 px,
    with 15% hysteresis so a thing does not flicker between tiers.
  - Models are loaded on first use, never at start.
- **Where they show:**
  - held in the hand: tools stand upright, the rest are centred;
  - lying on the ground, within 40 m;
  - on shop shelves, as instanced stock;
  - café tables and chairs at street cafés;
  - a courier's parcel, drawn as its pack (pizza box, food bag, tote, shipping box).

## 2 · Physical commerce: using and selling

- **Things with an identity** (`things.mjs`).
  - The bag's counts stay the stack view.
  - A record is made only for a unit that needs one: a parcel, a box with contents, something
    found, something listed.
  - A record holds its owner, where it is, its container (nested two deep at most), its
    condition, and latent traits drawn from a seed: age, corrosion, completeness, a hidden fault.
- **Uses** (`uses.mjs`). Each item gets the verbs its kind allows: wear, read, place at home,
  fill, light, charge, lock, mail, clean, take apart, cook, open / pack / seal, test, inspect,
  repair with a kit, gift.
  - Placed furniture makes a home more comfortable, and comfort speeds resting
    (`vitalsStep` comfort).
- **Selling** (`resale.mjs`, `commerce.mjs`).
  - Six channels:
    - a second-hand counter pays at once and least;
    - a specialist pays more for what it knows;
    - consignment sells for you, slower, for a commission;
    - a board listing waits for a buyer near you;
    - a shipped listing reaches further, for a commission and the carrier's fee;
    - a recycler pays by the kilo.
  - An offer is the buyer's own. It is set by condition, missing parts, a fault found, the
    buyer's cash for the day and how many like it the buyer has already bought. It holds for its
    hours.
  - Eligibility is per thing: it must be yours, carried, not promised to a buyer, not on
    consignment, and empty.
  - A shipped receipt has five lines: seller, commission, carrier, tax and total. Tax is charged
    on the item only, and the policy is recorded on the receipt.
  - Buyers for a listing write in Messages, with Accept / Decline.
- **Deliveries are real packages.**
  - The order is packed from the shop's own goods into a pack that fits them.
  - The pay is held in escrow. A broken seal pays nothing, a spill pays half, a damaged parcel
    pays three quarters.
  - Only the courier may lift a job's parcel.
  - Cancelling a delivery ends the package and gives up the escrow.

## 3 · Believable outcomes: drops and chance

- **Same seed, same result** (`outcomes.mjs`).
  - Every outcome is seeded by the world, the thing, its version and the event.
  - `Outcomes.once` makes each event resolve once: a collision repeated in the same 15 s is one
    collision.
- **Outcome curves:**
  - **a wheel taken off:** usable / damaged / stuck by condition, skill, tool and corrosion;
  - **a dropped package:** 75/20/5 intact / damaged / broken from 1 m; under 0.2 m it is always
    intact;
  - **reclaiming material:** 55/30/15;
  - **foraging, a found container's contents, a device's state when tested, vandalism and crash
    yields.**
- **Rules for what can be taken:**
  - Breaking someone else's glass leaves shards as litter, not loot.
  - Salvage comes only from what is yours.
  - A locked thing needs bolt cutters in hand.
  - A car with fewer than four wheels cannot be driven.
  - A car hitting you above 2 m/s knocks a package out of your hands.
- **Pedestrian bumps.** A nudge under 1.2 m/s is now severity 0, not an injury.

## The car holes

Some triangles in the imported traffic models are wound against their own vertex normals, so
back-face culling showed them as holes:

| Model | Triangles wound the wrong way |
|---|---|
| Porsche | 347 |
| Cuore | 133 |
| Bus | 409 |

- **Fix 1.** `vehicles.mjs` `rewindToNormals` turns each such triangle round at load (glass
  excepted).
- **Fix 2.** The Jeep's and the truck's traffic LOD1s are cracked: open edges went from 26 to
  2,125 and from 1,472 to 2,404. Traffic now uses their full models (`FULL_FOR_TRAFFIC`).
- **Checked headless** from four sides each: Cuore, Jeep, box truck and Porsche showed no holes.

## NPC bodies

The full-tier figure was a box torso, a ball head and box limbs. It is now turned on a lathe.

- **Body:** hips, waist, chest and shoulders; a neck, ears and a nose that shows which way the
  head faces.
- **Limbs:** tapered arms with hands; legs that narrow to the ankle, with shoes.
- **Cost and poses unchanged:** still seven instanced parts, and the walk and ride poses work as
  before.

### Dressing (`toneMaterial`)

Each part takes a cloth colour, a second colour below a cut, and an accent:

| Part | Above the cut | Below the cut / accent |
|---|---|---|
| Leg | the trousers | skin below the hem; the shoes as accent |
| Arm | the sleeve | skin below the cuff; the hand is always skin |
| Torso | the shirt | the trousers below the belt |

- A skirt is one more instanced part.
- Hair is cut to its length: short, to the collar, or long.

### Who wears what

`outfitFor` uses a stream of its own, so the heights and builds are unchanged.

| Choice | Share |
|---|---|
| Shorts | 12% |
| Skirt | 30% of women |
| Short sleeves | 34% |
| Long hair | 62% of women, 8% of men |

- Someone in a work uniform wears its trousers and long sleeves.
- The moderate tier takes the same trousers and shoes.

## Tests

- `tests/city_commerce.test.mjs`: 18 tests, the plan's acceptance examples.
- `tests/city_objects.test.mjs`: 5 tests covering the manifest, bindings, sizes, LOD and the
  rewinding.
- `tests/city_npc.test.mjs`: dressing.
- City total: 223 passing.
