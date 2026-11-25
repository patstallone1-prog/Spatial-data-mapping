# Hit reactions: where a blow lands, what the body does, what the person does next

Built on the material mechanics engine (docs/62-material-mechanics.md). Code: `docs/city/hit-reaction.mjs`;
the world takes the outcome in `cmd_strike_person` (`docs/city/world.mjs`); the view plays it in
`strikePerson` (`docs/city/view.mjs`).

## Where it lands
`hitZone(aimY, height, seed)` takes the height the swing was aimed at and adds about a hand's breadth of
scatter. Now and then a raised arm catches the blow. The zones are head, chest, belly, arm and leg
(`BODY_ZONES`), and each has its own layers: skin, fat, muscle and cortical bone. Those are catalogue
substances, and every one of them lists its toughness.

## What the body does
`blowOn(M, {joules, zone, tool}, victim)`:
1. The engine strikes the zone's layered body with the implement (`M.strike`). That gives a contact force,
   the restitution and the layers the blow reached.
2. The momentum the blow passes on moves the centre of mass. It acts through the share of body mass the
   blow carries at that height: a blow to the leg barely moves it, one to the chest or head moves it most.
3. The capture point (Hof 2005, `x + v/ω0` for an inverted pendulum) is compared with the foot's margin and
   the person's strength:
   - inside the margin: a **flinch**;
   - within up to 2 steps of 0.3 m: a **stumble** back;
   - beyond that: a **fall**.
4. A head blow above `head_stun_j` can stun a weaker neck and drop the person. If the force exceeds the
   zone's fracture force, a bone breaks.

Measured outcomes:
- An average punch makes an average person stumble one step; a big, strong person only flinches.
- A 35 J punch to the head of a light person drops them.
- A claw hammer to the head drops anyone.
- A sledgehammer breaks bone; a punch never does.

## What the person does next
`instinct(temperament, ctx)` scores five acts: fight back, run, call the police, call for help, or freeze.
The scores come from the person's temperament (nerve, temper, care, civic) and from the odds: their
strength against yours, the number of witnesses, how badly they are hurt, whether a phone is to hand and
whether police are near. A police officer arrests you. A person who fell is down.

Over 3000 people:
- each of the four main acts happens often;
- freezing is rare ("idle, probably not").

## No sinking
Each person in view now gets an exact ground height (`footAt`), refreshed when they move 10 cm. The old
lookup was cached on a 1 m grid, and over 6000 points 1.75% of samples sank more than 5 cm, the worst by
0.42 m.

Tests: `tests/city_hit_reaction.test.mjs`. They also check that every material, every city item and every
body layer has a substance with its toughness listed.
