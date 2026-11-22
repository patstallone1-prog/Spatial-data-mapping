# 56 · Animals in the living city: a plan

Status: plan only. Nothing here is built yet. The aim is to settle how animals live in the city,
how much each one costs to run, and how they meet the player, before any code is written.

The city already has the pieces animals would use:

- **Streets and kerbs.** `fleet.mjs` streets, kerbs and lanes give routes on land.
- **Water.** The water mask and classes (`cityWaterAt`, `waterProperties`) and the new depth model
  (page module 33) give fish and dolphins somewhere to be.
- **Detail tiers.** `detail.mjs` has FULL, MODERATE, LOW and TRACKED tiers.
- **Instanced bodies.** The crowd's GPU-skinned, instanced figures (`npc-figures.mjs`) show how to
  draw many bodies cheaply.
- **Authoritative server.** The city server (`server/city`) holds anything that belongs to someone.
- **Harm and care.** Injuries (`harmNow`, `cmd_hurt`), the ambulance-style billing for hitting
  someone, and the `outcomes.mjs` reporting are all there to reuse.

## 1. Three ways an animal exists

Every species is one of three kinds of record. This choice decides what it costs and what the
player can do with it.

| Kind | Tracked when unseen? | Where it lives | Examples |
|---|---|---|---|
| **Kept** | Always (server) | `world.mjs` record, like a car | Pets you own; strays you are fostering; a named animal in a quest; an injured wild animal taken to a vet or rescue |
| **Resident** | Coarsely (district clock) | The district's population, seeded like the crowd's households | Neighbourhood cats, the coyotes of the Presidio, the gull colony on the breakwater, the Marina's dogs walked by NPCs |
| **Ambient** | No (spawned near you, gone when out of sight) | The viewer only, from a seeded field | Pigeon flocks, sparrows, fish schools, mice, rats, flies, crabs |

### Kept animals

A kept animal is a server record with id, species, name, owner, health, hunger, mood, location,
licence and microchip. It goes on existing when nobody is looking, the way a parked car does.
Only kept animals can be owned, injured lastingly, billed for, or come back the next day.

### Resident animals

A resident animal is seeded per district from a rule: so many cats per hundred households, so
many coyote packs per park acre.

- **Routines.** Each one has a routine on the game clock, like an NPC's day (`routines.mjs`).
  Asked about while unseen, its position is computed from the routine, not simulated.
- **Promotion.** A resident becomes kept the moment the player does something lasting to it:
  - feeds it three days running;
  - hurts it;
  - adopts it;
  - reports it.

### Ambient animals

Ambient animals are drawn from a deterministic noise field keyed by cell and hour. The same
corner at the same hour always has pigeons, so they read as real without being stored.

- **Spawning.** They spawn just outside the view and despawn once they have been out of sight for
  some seconds, as ambient birds do in most open-world games.
- **Interaction.** Nothing done to them persists beyond the flock reacting.
- **Lasting acts.** Anything lasting (a pigeon hit by a car, then picked up) turns that one
  individual into a kept record.

## 2. The species

Behaviours are written as the states an animal moves between. Every animal has the shared
states:

- `idle`
- `wander`
- `flee`
- `injured`
- `dead`

plus its own.

### Water

#### Fish (bay and ocean; carp and koi in the Palace of Fine Arts lagoon) — ambient

- **Behaviour.** Schools move as a boid flock in a volume under the water surface. The volume
  is bounded by the depth model (module 33) and kept a body length from the bottom.
- **Reactions:**
  - They scatter from a swimmer within 2 m.
  - They cluster under a dropped piece of bread.
  - They leave an area where a boat engine runs.
- **Drawing.**
  - Instanced, one mesh per species, with a vertex-shader tail wave.
  - No skeleton.
  - Hundreds per draw call.
  - Only drawn when the camera is near or under the water, or within 30 m of the shore.
- **Interactions.**
  - Fishing (rod item, a cast, a bite timer by species and hour), with a licence check: the
    California fishing licence, which a warden NPC can ask to see on the pier.
  - Feeding.
  - Catching by hand (rare, in shallows).
- **Injury.** Caught fish can be kept (a bucket item), eaten, sold to a restaurant (the kitchen
  game's supply), or released. A fish out of water loses health per minute.

#### Sharks (leopard sharks in the bay shallows; rarely a sevengill; great whites only off Ocean Beach and the Farallones) — resident for the bay, ambient offshore

- **Behaviour.**
  - Patrol a loop along the bottom contour.
  - Are curious about a swimmer at a distance, and turn away when approached.
  - Leopard sharks are harmless and say so in the Nearby panel.
- **Bites.** A great white is the only one that can bite, and only:
  - outside the Golden Gate;
  - to a player swimming at the surface for a long time;
  - at a probability far under one per in-game year of swimming.
  - It is shown as a warning before it can happen ("shark sighted: beach advisory"), as SF really
    posts advisories.
- **Injury.** Fishing line and hooks (they carry them), boat strikes, and being stranded at low
  tide.

#### Dolphins and porpoises (harbour porpoises under the Golden Gate Bridge; bottlenose off Ocean Beach) — resident

- **Behaviour.**
  - Pods follow a tide-timed route through the Gate, as SF's porpoises do on the flood tide.
  - They surface on a breath cycle (porpoise about every 30 s, dolphin a few minutes), with a
    small arc animation.
- **Reactions.** They keep 10 m from a swimmer, and ride a boat's bow wave if one exists.
- **Interaction.**
  - Watching them makes a Nearby entry and a photo, which feeds the existing photo gate
    (`photo_gate.py`) as wildlife photos.
  - Harassing them (chasing within 50 yards, the federal rule) is an offence a ranger can cite.
- **Injury.** Line entanglement and boat strikes, both reported to the Marine Mammal Center.

### Air

Birds share one flight model: take-off, flapping, gliding, landing on a perch.

- **Perches** come from the world: roof edges, wires (module 21's overhead wires), lamp posts,
  trees, benches and the ground.
- **Drawing.** Instanced, with a shader wing flap at far tiers and a three-bone skeleton near.

| Species | Kind | Where | Behaviour |
|---|---|---|---|
| Rock pigeon | ambient | Plazas, transit stops, under freeway decks | Flocks of 5–40 on the ground; peck where food is (outside cafés, dropped food). Flush as one at a runner, a dog or a car door; circle and land 20 m on. Roost under eaves at night. |
| Western gull | resident colonies, ambient singles | Waterfront, piers, rubbish bins, the breakwater | Steal food from a player holding food near the water (a real Marina hazard). Follow fishing boats. Loud. Nest in spring on flat roofs and dive at anyone near the nest. |
| American crow / common raven | resident | Parks, the Presidio | Pairs and family groups. Remember a player who hurt one: the group mobs them on sight for days, as crows do. Bring "gifts" to a player who feeds them often (a rare item). |
| Brown pelican | ambient | Over the bay | Glide in lines low over the water; plunge-dive for fish. Never land in the city. |
| Great blue heron / snowy egret | resident | Lagoon edges, the Crissy Field marsh | Stand still for minutes; slow stalk; strike at fish. Fly off with a croak at 15 m. |
| Red-tailed hawk | resident | Over parks, on light poles | Soar in thermals; perch on poles over lawns; drop on a rat or squirrel. Small birds alarm-call and scatter when it passes. |
| Anna's hummingbird | ambient | Gardens, flowering street trees | Hover at flowers; dart; defend a feeder. Drawn only at FULL tier (tiny). |
| House sparrow / white-crowned sparrow | ambient | Hedges, café tables | Hop under tables and take crumbs. Very skittish. |
| Telegraph Hill parrots (cherry-headed conures) | resident flock | Telegraph Hill and the Embarcadero; outside the Marina's area today, kept for when the area grows | A flock of ~200 moving between roosts on a daily route; loud. |

### Land

#### House mouse — ambient

- **Where.** Indoors: shops and restaurants, from the inferred interiors.
- **Behaviour.** Seen at dusk, along walls (a wall-following path in a room's plan). It flees
  to a gap.
- **Interactions.**
  - A restaurant with mice seen fails a health inspection (ties into `kitchen.mjs` cleanliness).
  - Traps are an item; a pest-control job is a career task.

#### Norway rat — resident at a population level

- **Where.** Alleys, sewers (the waterworks layer's sewer lids), behind restaurants, the waterfront.
- **Behaviour.**
  - Comes out at night.
  - Its numbers rise with uncollected rubbish: the garbage system already tracks spilled
    rubbish, so rats follow it.
  - It runs along kerbs and building edges, and freezes and then bolts from a walker.
- **Disease.** Can carry it: a bite is a small health loss and a clinic visit.
- **City response.** Rat numbers in a block are a city statistic that triggers a 311-style
  complaint and a city contract job (pest control).

#### Dog — kept (pets, the player's or NPCs'), resident (NPC-walked dogs), never ambient

- **Breeds.** Size classes (toy, small, medium, large, giant) with breed looks. Each has its own
  temperament: energy, sociability, prey drive, reactivity.
  - This reuses `temperament.mjs`'s idea.
- **Behaviour.**
  - On lead: walks at the owner's side, pulls toward smells, stops to sniff at trees and posts,
    marks.
  - Off lead: only in dog parks (the parks layer has them) or the beach's off-lead areas
    (Crissy Field East Beach and Ocean Beach rules).
  - Meets other dogs: sniff, then play, ignore or a scuffle, by both temperaments.
  - Chases a thrown ball (the throw system: `handling.mjs` throwOf already gives the landing
    point).
  - Chases cats, squirrels and pigeons by prey drive.
  - Barks at strangers by reactivity.
- **NPC dogs.** NPCs who own dogs (the households model) walk them on a routine: morning and
  evening, around the block or to the park.

#### Cat — kept (pets), resident (outdoor cats and ferals)

- **Behaviour.**
  - Indoor cats stay in their home's interior.
  - Outdoor cats have a home range of a few blocks, and sit on stoops, car bonnets, fences and
    windowsills.
  - They watch birds, stalk and pounce (rarely catch).
  - They hiss and run from dogs and climb a fence or tree.
- **With the player.**
  - Approach a calm, crouched player slowly; flee a running one.
  - Can be petted after enough trust (a per-cat trust value that rises when fed).
- **Ferals** keep to colonies (behind businesses, in the Presidio) and never take to being
  handled. Trap-neuter-return is a volunteer task.

#### Coyote — resident (the Presidio and parks packs: SF really has about a hundred)

- **Behaviour.**
  - Mostly dusk to dawn.
  - Travels along park edges and quiet streets in ones and twos, and dens in the Presidio.
  - Wary of people: keeps 20–40 m, trots off when approached.
- **Bolder coyotes** follow off-lead small dogs, and in pupping season (April–August) chase dogs
  near a den.
- **Hazing** (shouting, standing tall, throwing toward it) drives it off and keeps it wary. This
  is the city's real advice.
- **Feeding** makes it bold, and a bold coyote becomes a reported "problem coyote" that Animal
  Care & Control comes for. The player's act changes the animal for good, so feeding it promotes
  it to kept.
- **Never attacks an adult player.** It can bite a cornered child NPC or take a small pet,
  rarely and with warnings first (sightings, a posted notice).

## 3. Tracking and cost: what each kind spends

The budgets are to be measured with the existing perf bench (`viewer-perf-measuring`), not
guessed. These are the targets.

- **Kept.**
  - Server records: tens per player at most.
  - Simulated only near a player; elsewhere they are a position and a state on a schedule (home,
    with owner, at the vet).
  - No per-frame cost when unseen.
- **Resident.**
  - At most a few hundred per district.
  - A routine evaluated on demand (as people are: the TRACKED tier has a position and nothing
    else).
  - Drawn through the same detail field as the crowd:
    - FULL: skeleton within 25 m;
    - MODERATE: baked loop within 60 m;
    - LOW: a billboard or instanced shape within 150 m.
- **Ambient.**
  - A ring of cells round the camera.
  - Each cell's animals are made from its seed when it comes into the ring and dropped when it
    leaves.
  - Capped per frame: for example 400 birds, 600 fish and 40 rodents drawn, by distance.
- **Garbage.** No per-frame allocation. The memory-trim pass found per-frame garbage was the
  freeze cause, so animals use packed typed arrays like the crowd's static buffers.

## 4. Interactions

What the player can do, by key and by context. These go through the action bar the city already
has (the bar of 8, the Nearby panel, and Enter, G, U, X and Q):

| Act | With | Effect |
|---|---|---|
| Look / photo | any | Nearby entry: species, what it is doing, whether it is wild. A photo is a collectible. |
| Feed (U with food) | birds, cats, dogs, fish, coyotes, rats | Raises trust; flocks gather; feeding coyotes, gulls and pigeons is against the rules in SF parks and can be cited. |
| Pet | dogs, cats with trust | Mood up (theirs and yours: a small stamina or stress benefit). |
| Throw (Q) | ball, stick, bread | Dogs fetch; birds come to bread; anything thrown *at* an animal is cruelty. |
| Haze (shout key / stand tall) | coyotes, gulls | Drives them off; keeps coyotes wary. |
| Pick up (G) | small animals: a cat with trust, an injured bird, a caught fish | Carried in both hands (the handling model's two-handed hold) or in a carrier item. |
| Leash / unleash | your dog | Leash law: off-lead outside an off-lead area is a fine if seen (the witness system: `enforcement.mjs` `witnessOf`). |
| Adopt / buy | shelter (SF Animal Care & Control), breeder, a stray | Makes a kept record; fees; licence. |
| Report | injured, dead, problem animal | A call to Animal Care & Control; an officer NPC comes (like the patrol car). |
| Harm (X, driving into one) | any | See §6; cruelty to animals is a crime with real consequences. |

## 5. Pets: ownership

- **Getting one.**
  - Adopt at the shelter: SF ACC in the Mission. A Marina pet shop is a store kind that could
    sell supplies but not animals.
  - Take in a stray: a resident cat that trusts you can be adopted after a "found animal" wait,
    during which its owner, if it has one, may claim it.
  - Buy from a breeder: dogs, at a real-world price range.
- **The record.**
  - Species, breed and size, name, age, sex, temperament.
  - Health, hunger, thirst, energy, mood, cleanliness.
  - Licence (SF dog licence, yearly; the fee is lower if spayed or neutered) and microchip.
  - Vaccinations (rabies required), vet history, insurance (optional, monthly).
- **Care.**
  - Food and water at home: bowls are interior objects.
  - Walks: a dog's energy and mood need them. A dog left too long gets bored and damages things
    at home, with costs to the home's condition.
  - Litter for cats. Grooming. Vet checkups.
- **The books.** Food, licence, insurance and vet bills go through the ledger like every other
  bill.
- **Neglect.** Hunger or thirst at zero for a day, no shelter, or an injury left untreated:
  - is noticed by neighbours, who report it (witness model);
  - a welfare visit follows;
  - repeated, the animal is taken by Animal Care & Control and the player is fined. It is never
    silently lost.
- **Away.** While the player is offline:
  - a pet at home is fed by the auto-feeder item, or by a paid pet-sitter or dog-walker (an NPC
    job and a player job);
  - without either, it loses condition at a rate slow enough that a normal day away is safe.
- **Multiplayer.**
  - Pets belong to an account.
  - Another player's dog is seen walking with them (peer sync, like peer cars).
  - Dogs of two players meet with both temperaments.
  - Stealing a pet is theft, as taking a car is.

## 6. What injures animals

Damage goes through one function (like `harmNow` for people). Each injury has a type, a severity
and a cause, by what hit it and how hard (the same energy model the crash and swing code uses):

| Cause | Who gets it | Notes |
|---|---|---|
| Cars | dogs, cats, coyotes, pigeons, gulls, rats | The commonest. Speed sets severity (the same impact-energy formula as people). A hit animal is noted as an incident (`noteIncident`); hitting a dog or cat and driving off is reportable, as in California. |
| Thrown objects, blows | any | Deliberate harm to an animal is animal cruelty: a crime (fine, then court for repeated acts, through the existing court and jail flow). |
| Other animals | dogs (fights), cats (dogs, coyotes), small pets (coyotes), birds (hawks, cats) | Simulated between residents only near the player; off-screen as rare events in the routine. |
| Fishing gear | fish, birds, seals, dolphins, sharks | Discarded line left by NPC or player anglers entangles; a player can free an entangled bird (a minigame-light action, a few seconds holding G). |
| Poison | rats (bait), dogs and cats that find bait or eat rubbish, chocolate, xylitol | Ties into the rubbish system and items. |
| Heat and cold | dogs left in cars (a real hazard: a car's interior heats in the sun), pets left out | The car's interior temperature is a small model of sun, shade and time; a passer-by can break the window, as California allows. |
| Water | dogs off lead at Ocean Beach in big surf, a fallen cat in the lagoon | Animals can swim (the module 33 depth model), get tired, and need rescue. |
| Disease and age | kept animals | Slow: a checkup catches it; untreated it worsens. Old animals die at the end of their lifespan, with a notice. |

## 7. How an injured animal acts

How an injured animal behaves depends on whether it is wild or domestic, and on how badly it is
hurt.

- **Minor injury.**
  - **Wild:** flees more readily, limps (a gait-clip blend, like the crowd's injured walk), stays
    away from people, recovers by itself over days.
  - **Domestic:** limps and whimpers, goes to its owner or home. A stray hides under a car or in
    a doorway.
- **Serious injury.**
  - **Wild:** cannot flee, lies down in cover, and may bite if handled. Coyotes and raccoons must
    not be handled; the right act is to report.
  - **Domestic:** lies still, cries, will let a known person approach, and may bite a stranger
    out of pain.
- **Bird down.**
  - It cannot fly and hops to cover. Picked up gently (G, with a box or towel item, or in hands)
    it can be taken to a rescue: WildCare and the SF SPCA, plus the Peninsula Humane Society's
    wildlife centre, take wildlife.
- **Death.**
  - The body stays for a while and is removed by city services: a "dead animal" 311 report, and
    DPW picks it up.
  - A kept animal's death is a notice to its owner, with the cause.

## 8. The vet and rescue

- **Places.**
  - Vet clinics are a business kind. Their interiors come from the inferred-interior engine:
    reception, exam room, kennels.
  - The Marina has real ones, to be read from the places data.
  - An emergency animal hospital is open all night.
  - A wildlife rescue drop-off is separate from vets: wild animals go there, free.
- **Getting there.**
  - Carry the animal (hold or carrier), drive with it (it rides in the car: the car-entry
    animation puts it on the passenger seat), or call the clinic's or ACC's pick-up (a fee, a
    wait).
- **At the vet.**
  - The exam is a short scene: the vet NPC diagnoses from the injury record, and quotes
    treatment with an estimate.
  - This reuses the repair bay's estimate-and-authorise pattern (`workshop.mjs`, with its never
    hard-block rule: you can decline and take the animal home with a warning about what happens).
- **Recovery.** Treatment takes game-days.
  - The animal comes home with care instructions (rest, medicine items given on a schedule).
  - Insurance pays a share.
  - Unpaid vet bills go to collections like any bill.
- **Jobs.** Vet technician, dog walker, pet sitter, groomer, ACC officer and wildlife rescue
  volunteer are careers in the existing career system.

## 9. Law and the city

The real San Francisco and California rules each touch the game in one way:

- **Dog licence.** SF requires a yearly dog licence; dogs without one can be cited.
- **Leash law.** Dogs on a lead of 6 ft or less outside off-lead areas; fines on a witness.
- **Feeding wildlife.** Banned in SF parks; fined.
- **Cruelty.** California Penal Code 597 makes animal cruelty a crime; it goes through the court
  flow.
- **Hit and run.** Hitting a dog or cat and driving off without reporting is an offence.
- **Animal in a hot car.** A passer-by may break the window (Civil Code 43.100); leaving the
  animal is the offence.
- **Wildlife harassment.** The Marine Mammal Protection Act applies (porpoises, seals, sea
  lions).

## 10. Data sources to read

These are the places the populations would be grounded in. None are fetched yet, and fetching
any needs the user's go-ahead.

- **eBird.** Where and when birds are seen in SF, by species and season.
- **iNaturalist.** Coyote and other sightings; the San Francisco Recreation and Parks
  Department's coyote page and its map of den areas.
- **SF Animal Care & Control.** Shelter intake numbers, adoption fees, licence fees.
- **SF 311 open data (DataSF).**
  - Dead-animal and rat complaints, by location: rat density by block.
  - "Animal care" requests.
- **NOAA and California Department of Fish and Wildlife.**
  - Fish species of the bay, fishing licence rules, the shark advisories off Ocean Beach.
- **The Marine Mammal Center (Sausalito).** Porpoise and sea-lion patterns at the Gate.

## 11. Building it, in order

1. **The record and the field.**
   - The three kinds (kept, resident, ambient) in `docs/city/animals.mjs` as pure code.
   - The ambient field: cells, seeds, spawn and despawn.
   - Tests for determinism and caps.
2. **Pigeons and gulls.**
   - Instanced, the flight model, perches from the world, flushing from people and cars.
   - The cheapest wins: the city feels alive at once.
3. **Fish.** Schools under the water using the module 33 depth model; feeding; the pier.
4. **Dogs walked by NPCs.**
   - The households model gives owners; the lead and the walk; meeting dogs; dog parks.
5. **Pet ownership.**
   - Adoption at the shelter, the server record, care, bills, licence and the leash law.
6. **Cats.** Residents with home ranges, trust, adoption of strays.
7. **Injury and the vet.**
   - One harm function, the injured behaviours, carrying, the clinic scene, the wildlife rescue.
8. **Coyotes.** Night routines in the Presidio and parks, hazing, feeding consequences.
9. **Rats and mice.** Tied to rubbish and kitchens; pest control jobs.
10. **Dolphins, porpoises and sharks.**
    - At the Gate and offshore, when the City area reaches the water past the Marina.

## 12. Questions for the user before building

- **Licensed models.** Should animals use licensed models, or should they be modelled here? The
  bird and fish shapes are simple enough to model; dogs and cats need good rigs to look real. A
  licensed or CC0 set needs your OK to download.
- **Violence.** How much violence toward animals should the game allow? The plan makes cruelty a
  crime with consequences but still possible, as the game treats people. It could instead be
  blocked entirely.
- **Pet death.** Should a kept pet be able to die of neglect, or only become sick and be taken
  away?
- **Area.** Is the City area staying the Marina? Porpoises and great whites only make sense once
  the area reaches the Golden Gate and Ocean Beach.
