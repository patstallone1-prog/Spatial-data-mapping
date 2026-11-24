# 62 — Material mechanics: one engine for cutting, striking, breaking, friction and climbing

`docs/city/mechanics.mjs` and `docs/city/climbing.mjs` are a general contact-mechanics engine.
They know what each material is (its stiffness, strength, hardness, toughness, grain and
surface) and what each tool is (its edge, its point, its face, its mass). From those figures they
work out what a contact does: how far a blade sinks, whether it parts the material or only dents
it, what mark is left, how much weaker the struck thing is, what happens to the tool, and whether
a hand or a foot holds on a surface.

There are no per-case rules. Nothing in the engine knows about "a knife in a tree" or "an axe in
a tree". A chef's knife sinking 19 mm into green oak and a felling axe cutting a 16 mm V-shaped
kerf in the same trunk come from the same integral, with different edge geometry, mass and
energy. Trees, windows, steel plates, flesh, ice, canvas and climbing walls go through the same
few laws.

## Where the data lives

`docs/object-catalogue.json` gains a `mechanics` section:

| Part | What it holds |
|---|---|
| `substances` (60) | Wood species green and dry (Douglas fir, white pine, red and white oak, sycamore, white ash, decayed softwood), metals (mild, knife, axe and tool steel, aluminium, cast iron, chromed steel), glass (annealed, tempered), ceramics, stone, concrete, brick, stucco, ice, polymers, rubber, fabric, paper, board, plasterboard, tissue (skin, fat, muscle, cortical bone), apple, soils, leaf, water, and four paint films (exterior latex, alkyd enamel, polyester powder coat, car clearcoat). Each has density, E, ν, yield/UTS/compressive strength, hardness, fracture toughness or energy, grain (for wood: across- and along-grain values), brittleness and a surface (smoothness, texture, surface energy), with its sources. |
| `implements` (20) | Chef's, paring, butter and ceramic knives, machete, felling axe, hatchet, splitting maul, claw hammer, sledge, rubber mallet, wooden club, aluminium bat, crowbar, screwdriver, nail, window punch, ice axe, glass bottle, fist. Each gives its substance, mass, strike mass, grip limit and the geometry of its edge (radius, thickness profile back from the apex, contact length, the deepest the head can go), tip (radius, width and thickness profiles) and face (curvature and size). |
| `contactors` (10) | What touches a surface to hold or slide: dry, chalked and sweaty skin, a glove, shoe rubber, climbing rubber, a boot, a leather sole, gecko-type pads, bare steel. Each gives adhesion, hysteresis, base friction, moisture and contact area. |
| `item_materials`, `strike_kinds` | Which substance a city item of each material kind is, and which implement each existing tool kind in `rules.json` is. |
| `coatings` (5), `cladding_coats` | The coats things wear, each a layer of its own: exterior latex (90 µm, adhesion 1.5 MPa), alkyd enamel (110 µm, 3 MPa), powder coat (70 µm, 10 MPa), car paint (100 µm, 12 MPa), road marking (3 mm, 1.5 MPa); and which wall cladding classes are painted (render, concrete, wood siding, painted brick) and which show their own colour (brick, stone, tile, vinyl). |
| `forms` (45) | The shape each archetype meets a blow or a push with (box, beam, post, panel, round, wall, ground), its section and span, its corner radius, its biggest face, its coat and, where it is one thing, its mass. See "Object on object". |
| `sources` (44) | Every source cited, by key. |

Every existing catalogue material names its substance in a new `mechanics` field (`green_wood` →
`sycamore_green`, `lumber` → `douglas_fir_dry`, `glass` → `glass_annealed`, `none` → null). The
Python loader checks the section (`smc.world.catalogue.mechanics_problems`): every material's
substance exists, every implement names a substance, every contactor states its friction terms,
every strike kind names an implement, every coat names a substance and has a thickness and an
adhesion, every cladding coat and form names a coat, archetype and shape that exist, and every
cited source is listed.

### Sources

The figures come from published tables, never from fitting to the tests:

* Wood: USDA *Wood Handbook* (FPL-GTR-190) Tables 5-3a/b and 5-1; Jeronimidis 1980 and
  Stanzl-Tschegg et al. 1995 for fracture across and along the grain; NDS 2018 12.2.3 nail
  withdrawal; felling hinge practice (USDA Forest Service saw programme; Mattheck 1994).
* Metals and blades: ASM Handbook; Verhoeven, *Steel Metallurgy for the Non-Metallurgist*.
* Glass: Varshneya; EN 572-1; Haldimann, Luible & Overend; ASTM C1048 / EN 12150.
* Ceramics: Munz & Fett. Rock: Goodman; Jaeger, Cook & Zimmerman; Atkinson 1984. Concrete and
  masonry: ACI 318, fib Model Code 2010, Hendry.
* Ice: Petrovic 2003; Barnes, Tabor & Walker 1971.
* Tissue: Annaidh et al. 2012; Pereira et al. 1997; Shergold & Fleck 2004; McKee et al. 2011;
  Purslow 1985. Bone: Currey; Zioupos & Currey. Food: Vincent 1990; Khan & Vincent 1993.
* Polymers: Ashby. Sheets: Niskanen. Soils: ASAE S313; Bengough & Mullins.
* Friction: FHWA *Guide for Pavement Friction*; Persson; Derler & Gerhardt 2012; Amca et al.
  2012 (chalk).
* Climbing: Baláš et al. 2012, Amca et al. 2012 and Bourne et al. 2011 (finger strength); Hawkes
  et al. 2015 (gecko-type adhesive).
* Stabbing: Horsfall et al. 1999; HOSDB body-armour standard 2007; Knight 1975; O'Callaghan et
  al. 1999.
* Mechanics: Atkins, *The Science and Engineering of Cutting* (2009); Johnson, *Contact
  Mechanics* (1985); Lawn, Evans & Marshall 1980; Roark's *Formulas for Stress and Strain*;
  Cremer & Heckl (plate impedance); McCarthy et al. 2007 (edge radius).

## The laws

### Cutting and stabbing: one resistance, integrated over depth

A sharp feature (an edge or a tip) sinks while its energy lasts. At each depth `x` the engine
works out the force to go further, `F(x)`, and steps until `∫F dx` uses up the blow's energy. The
blow can also stop earlier: when the tool's grip slips (a thrust is capped by `grip_limit_n`; a
swung head carries its own load), when the head is buried (`max_depth_m`), or when the work comes
out the far side.

`F(x)` is the cheaper of two ways for the material to give:

* **Separation (Atkins).** New crack area × fracture energy R, plus the apex's bluntness (2r ×
  crush pressure), plus wedging the sides apart (lateral pressure × blade thickness × width),
  plus flank friction (μ × closing pressure × flank area). Slicing divides the push by
  √(1+ξ²).
* **Indentation.** Only for materials that flow: wood, metal and stone. The material crushes
  ahead and around and the wedge is paid in full, with no fracture term. Soft elastic solids
  (skin, rubber, fruit) never dent. They part, and their wedge pressure is capped at their
  tensile strength.

Wood is anisotropic, read from `grain`:

* **Across the grain:** lateral pressure from compression parallel to the grain, toughness
  across it.
* **Along the grain:** lateral pressure from compression perpendicular, toughness along it.
* **End grain:** the front pays the greater of the edge's crush and compression parallel.

Bearing pressure follows the Eurocode 5 embedment size law, from the Janka pressure: p(w) =
p_J·(w/11.28 mm)^−0.3, clamped to 0.5–10 × p_J.

Where a crushed flank springs back on the blade, the closure is φ = 0.45 × the crush pressure.
That one constant is calibrated to the NDS nail-withdrawal formula, W = 1380·G^2.5·D lb per inch.
The same φ then gives a stuck axe's withdrawal force and a knife's grip in wood.

**Cracks ahead of the edge:**

* A wedge drives a pressure-limited crack, a = (2P/K)²/π.
* A round struck on its end splits like a double cantilever, a = (3·E·h³·t²/16G)^¼. A maul
  splits an oak round that an axe only enters.
* Brittle solids crack from indentation, c = (χF/K)^⅔ with χ = 0.016·√(E/H) (Lawn, Evans &
  Marshall). Tempered glass shatters once a crack passes its compressed layer, a fifth of the
  thickness deep.

**Glancing.** A slanting blow skids when tan(angle) > μ + bite. The bite is the kerf wall's
bearing at the blade's thickness over the embedded area, against the blow's normal energy.

**Marks.** The mark is read from what happened:

* none, scratch or dent;
* a slit, or a V-shaped wedge kerf (a blade thick for its depth);
* a hole (a round point);
* a notch, once alternate cuts at least 30° apart pop the chip between them;
* a split, crack, chip or shatter.

Blows at one named spot, in the same plane, add up.

### Blunt blows

A face (a hammer, a club, a fist, a bottle) meets the surface in Hertz contact. It yields once
the mean pressure reaches 1.1 Y and hardens by Johnson's expanding cavity, p/Y = ⅔(1 + ln(E\*a /
3YR)), up to the hardness. The dent left is the depth less the elastic spring-back, π·a·p_m/2E\*.

A plate takes the blow two ways: locally (energy share m_p/(m+m_p)) and by bending as a whole.
Its point impedance Z = 8√(Dρt) caps the local force. Roark gives the centre bending stress, and
a clamped patch gives 0.75·p·(a/t)². Glass breaks when that stress passes its point strength plus
any temper. A ductile plate bends past its collapse load π·σ_y·t²/2. A tool with a shell (a
bottle) is checked by the same patch formula, so a bottle breaks on concrete and not on turf.

**Only the contact is measured.** A strike reads the sharpness of the feature that touches, and
nothing else. A tip carries its own side radius (`tip_side_radius_m`), separate from the edge's
`edge_radius_m`. So a knife blunted by chopping still stabs as before, and a point blunted on
stone still slices as before. Wear goes to the feature that was used (`wearTool`). Tests: "a
knife's point keeps its own sharpness", "and the reverse".

**Rim and crown.** A real face is crowned, with a chamfered rim (`face_rim_m`, 1.5 mm). Within
its crown angle, asin(D/2 / R), the crown meets the work as above. Tilted further, it lands on
its rim. The rim acts as a sphere of radius √(rim·D/2), so the same energy makes a narrow,
deeper crescent. It sinks only until the face rocks flat, at D·tan(tilt − crown); the energy left
over goes to the whole face. The mark records `crescent_m`. A perfectly flat face (R infinite)
has a crown of 0°, so any tilt lands on the rim. Option: `face_tilt_deg`. Test: "a hammer square
to the work dents round; canted past its crown it lands on the rim".

**Blunt glancing.** A blunt blow glances once tan(slant) > μ + depth / contact radius. Friction
holds the face, and so does the wall of the dent it has already made. A glance has outcome
`"glance"`, the mark is a scuff or a streak, and the result says `glanced` and `on_rim`. Test:
"blunt blows glance once the slant passes friction and the dent's wall". An edge's glancing is
the cutting law's (see "What still fails").

**Guided points.** `strike(..., { guided: true })` skips the tip's bending cap. Use it for a point
held straight by its hole, as a nail is by the wood it is already in. Its buckling is then checked
by the nail law in "Work by hand".

### What happens to the tool

* The apex flattens when the work is harder than the tool.
* The apex bends under its share of the side load, σ = 1.5·k·f/(r·tanβ). A brittle tool chips;
  a ductile one rolls.
* Grit wears the flanks (Archard, two-body abrasion, K = 10⁻² × min(H_abr/H_tool, 1.5)²).
* A point bends or breaks when its section's bending cap is reached.

The new radius is kept on the returned tool, so the next blow cuts with it. An edge counts as
dulled or rolled once its radius has doubled from its sharpened radius: the force to start a cut
rises roughly in proportion to the radius, so the next cut then takes twice the push. One chop
into green oak leaves an axe sharp. A hundred dull it. One blow into concrete blunts it 25-fold.

### How much weaker the struck thing is

A round (a trunk, a post, a branch) keeps the share of its **fully plastic section modulus**
that is left. The section is a 48×48 grid, taken about the worst of 8 axes. An open notch
removes its whole chord, and a kerf removes its edge's length. Wood fails in bending with its
compressed side yielded. The plastic modulus, unlike the elastic one, can only fall as wood is
cut away (a test cuts at random and checks it never rises).

An upright tree falls once less than 0.015 of its strength is left. For a notch straight across,
that is a hinge of about 16% of the diameter, close to the felling rule of thumb of a tenth. A plate or sheet loses
strength with its holes. A body that splits or shatters is broken.

### Friction

* μ = adhesion × surface energy × (0.35 + 0.65·smoothness) + hysteresis × texture + base,
  between a contactor and a surface.
* Water cuts the adhesive part where the surface cannot drain it; drainage = clamp(1.2·texture
  + 0.3·(1 − smoothness), 0, 1).
* Ice grows a premelted film as it warms: film share = 1 − ((melts − T)/(melts + 22 °C))^1.5.
* Gecko-type pads add a dry adhesive force, τ × area × smoothness⁴, so they need smooth
  surfaces.

`slope()` answers whether a shoe or a hand holds on an incline.

### Climbing

`climb()` is 2D statics, solved as a linear programme (a dense two-phase simplex with Bland's
rule). The aim is to minimise the effort s, the worst limb's share of its strength:

* **Contacts.** Each hand or foot is a contact with a friction cone, any adhesion and its
  pull-off.
* **Limb strength.** A limb's strength bounds the whole force, push and slide together,
  through a 16-gon around the circle.
* **Holds.** Holds are referenced to gravity: `slope_deg` is the gripped surface's slant from
  level, + sloping down and away. A hold stands out of the wall by half its depth.
* **Finger strength.** One hand on a 20 mm edge carries 0.2–0.8 of body weight, from untrained
  to elite. That scales by (depth/20 mm)^0.6, which reproduces the published two-handed range
  (0.5–0.65 body weight untrained, 1.3–1.6 elite). Jugs, slopers, open-hand presses and legs
  have their own shares.
* **Posture.** The climber picks the best posture. The hips go from 5 to 60 cm off the wall,
  and the hands from 0.7 to 1.0 of height above the feet, in 5 cm and 0.05 steps.

`holds` says whether the climber can stay still. `climbable` says whether each limb can let go
in turn while the rest hold, which is what a move needs. `releases` names which limbs can. So a
weak dead hang from two bars under a roof holds but is not climbable.

Wet holds, sweat, chalk, ice temperature, sticky rubber, a pack's load, the wall's angle, a stem
between two walls and gecko pads all come in through the same friction and statics.

## Work by hand (`docs/city/mechanics-work.mjs`)

`createWork(M)` adds the acts done with the hands to the strike engine. Each one is the engine's
own contact law plus the one law that belongs to the act. None of them is a rule about a
particular pair. The numbers are in `WORK`, and their sources are in the catalogue (`nail_driving`,
`soil_cutting`, `push_strength`, `balance`). The tests are in `tests/mechanics_work.test.mjs`.

### Hammering in a nail (`startNail`, `drive`)

* **Energy adds up.** Each blow adds its energy to `work_j`. The nail's depth comes from the
  total work against the wood's resistance over depth, not from each blow on its own, so it does
  not re-cross the length already driven.
* **The set tap.** The first blow on a fresh nail is a quarter blow (`set_tap` 0.25).
* **The crown rolls.** Within the face's crown the contact rolls onto the head's centre, so the
  blow drives straight. Only the slant past the crown pushes sideways, by
  share = min(tan(past), μ).
* **Sideways push.** The sideways force is min(2·gain·share, μN/k), where k = 3EI/L³ is the free
  length's stiffness.
* **Bending.** The nail yields when its deflection reaches M_y·L²/(3EI)·(1 − N/P_cr). Here
  M_y = F_yb·π·d³/32, with F_yb = 620 MPa (NDS / ASTM F1575). It buckles at 0.85·P_cr, with
  P_cr = π²EI/(0.7L)².
* **A bent nail.** The bend adds up blow by blow. At 15° (`bent_deg`) the nail is bent over and
  will not drive.
* **Hammer rash.** A face that skids off the head dents the wood beside the nail.
* **Holding.** A driven nail holds by the NDS withdrawal value, W = 1380·G^2.5·D lb/in over its
  driven length.
* **What it says.** The result gives how far the nail went, how far "N° off square" the blow was,
  and whether the nail is bent or home.
* **In the game.** The off-square angle of each blow is 1 + 6·wobble + 10·tiredness·wobble
  degrees, plus 9 when the blow comes within 650 ms of the last. Wobble comes from strength,
  tiredness from stamina.

### Digging (`dig`)

* **Going in.** The spade's edge is resisted by Terzaghi bearing over its edge area,
  (c·N_c + γ·z·N_q). Roots add their toughness, w·R. Both faces add adhesion and K0 friction.
* **The push.** A digger pushes the spade in by standing on it (their weight), or by stamping on
  it (a 0.15 m drop of their mass).
* **Levering out.** The spade levers the soil out against Rankine passive breakout (K_p, acting
  at z/3). The handle's lever arm sets the force, 250 N at the grip.
* **Ground that is not soil.** Paving, stone and the like are refused, with the strike engine's
  own result on that surface.
* **The soils.** Each soil in the catalogue carries cohesion, friction angle, adhesion and
  soil-on-steel friction (sand also carries a wet cohesion). Sand and duff dig easiest, then
  loam, then turf; paving not at all.

### Pushing (`push`, `pushCapacity`)

* **What you can push.** min(300–500 N by strength, μ(shoe, ground)·m·g); 0.6 of that can be kept
  up.
* **What it takes.** Rolling resistance by the wheels (car 0.012, bicycle 0.006, cart 0.03,
  bin 0.04, dolly 0.02), or sliding friction, or braked friction. A slope adds its weight on
  top.
* So a car in neutral rolls, and braked, or on ice, it does not.

### Shoving (`shove`)

* **The law.** A shove of 0.15 s gives the person a velocity v. Their extrapolated centre of mass,
  v·√(l/g), is compared with the margin to the edge of their feet: 0.1 m standing easy, 0.25 m
  braced.
* **The outcome.** Within the margin, they rock. Past it, one step can catch them up to 1.3 m/s,
  and they stagger. Beyond that, they fall.
* **Who falls.** Frail people and children have less margin. So a grown adult staggers, a child or
  a frail person falls, and nobody braced falls.

### Carving (`carve`)

* **The press.** The press into the wood is the push times sin(rake).
* **Skating.** Below the edge's cutting initiation force (`M.initiationForce`, which rises with
  the edge radius), the blade skates.
* **Cutting.** Above it, the cut is force-limited: the engine's grip limit is set to the press. So
  shavings are thin along the grain, and the blade skates across the grain or with a dull edge.

## Object on object (`docs/city/mechanics-collide.mjs`)

A pushed crate, a dropped log, a trolley rolling into a car: two things meet, and each is marked by
the other as far as the force can push the mark. `createCollisions(M, catalogue)` gives `stats`,
`contact`, `push`, `impact` and `scrape`. Like the rest of the engine it holds no per-pair rules.

### Every object is a stack of layers

`stats(archetype, {cladding, coat, mass_kg, fixed, form})` builds the stack from the catalogue:
the archetype's (or the wall cladding's) coat over its body. Each layer has its own hardness,
yield, modulus, strength, failure strain, toughness (K and G_c; wood's along and across its grain),
and the hardness a slider must beat to groove it (its grit's, for a gritty composite). A coat also
has its thickness and its adhesion. A painted stucco wall is therefore 90 µm of latex film (soft:
10 MPa, stretches to 150 %, held on at 1.5 MPa) over render (30 MPa, brittle, with sand grains of
about 1100 HV). Brick has no coat. A car door is 100 µm of two-pack clear (250 MPa, cracks at 4 %)
over 0.8 mm steel.

As a whole, each object has the strength and stiffness of its shape (Roark):

* **A beam on two supports**, struck mid-span: break at F = 4σZ/L, stiffness k = 48EI/L³.
* **A post fixed at its foot**, struck at a height: F = σZ_p/L, k = 3EI/L³.
* **Rounds and tubes** use their own Z and Z_p.
* **Ductile and brittle.** A ductile post bends for good at the yield moment (σ_y Z_p), and folds
  at the ultimate one. Wood and brittle solids break where they would bend.
* **A plate held at its edges** has stiffness 16πD(1+ν)/((3+ν)a²). A ductile sheet is dished in at
  its yield-line collapse load, 2π m_p = (π/2) σ_y t², whatever its outline: 251 N for a car door's
  0.8 mm skin. A brittle plate breaks when the bending stress under the load reaches its strength
  under a point (with any temper's compression): 1.35 kN for a 6 mm window.
* **A board** whose strength is the board's, not its core's, says so in the form (`flexural_mpa`).
  Paper-faced gypsum is 5 MPa by ASTM C1396.
* **Fixed things** (a building's wall, the ground) are half-spaces at the scale of a contact. They
  are not broken by a push.

### The contact, layer by layer

`contact(P, Q, F, {kind, sliding})` presses P's leading feature into Q with force F. The feature
is a corner (a sphere of the corner's radius), an edge (a cylinder along its height) or a face
(flat). Both sides take the same force, each at the depth its own stack gives.

* **Plastic depth through the layers.** F = 2πR ∫p(z) dz for a corner, F = 2L ∫p dρ for an edge,
  and area × p for a face, where p(z) is the flow pressure of whatever is giving at that depth.
  In one material this is the hardness law, F = πa²H.
* **A coat thinner than its contact is confined.** It bears Y(1 + 2a/(3√3 t)) (the slab
  solution), so under a wide contact the layer under it gives first. A coat harder than the layer
  under it is carried down on it, stretched, and not cut.
* **Sliding.** A corner bears on its leading half (ASTM G171: H_s = 8P/(πw²)).
* **The scratch ratio.** A layer is grooved only by a slider at least 1.2 times harder than it
  (Tabor), or than its grit for a composite. So the groove stops at a layer the slider cannot
  out-harden, and the rest of the load wears the slider instead. When neither out-hardens the
  other, both wear as plastic solids.
* **Spring-back.** The elastic part of the depth comes back, πa p/(2E*). What is left is the mark.
  A coat cut to its floor while the contact was on it stays cut.
* **Cracking.** A layer stretched with a dent or a groove reaches Tabor's strain 0.2 a/R. A coat
  past its failure strain cracks.
* **Flaking.** A cracked coat lifts off for π σ_f t / (2τ) either side (shear lag, Agrawal & Raj),
  with τ its adhesion. Half the adhesion, twice the flake.
* **Transfer.** The softer of two faces dragged on each other leaves a smear of itself on the
  harder (adhesive wear, which goes on where nothing yields), unless the harder is grooved.

Marks are reported per layer:

* **The thing dragged over:** scuff, scratch, cut_through, gouge, chip, dent, crushed, stretched,
  flaked, transfer.
* **The thing that leads a slide:** worn, worn_through.

### A push, a blow, a scrape

* **`push(P, Q, {force_n, angle_deg})`.** The share of the push square to Q's face presses them
  together; the share along it slides P along Q if it beats their static friction. Q moves only if
  it is free and the push beats its grip on the ground. Otherwise P is stopped there.
* **`impact(P, Q, {speed_mps})`.**
  * The blow's energy is ½μv² with the reduced mass (all of P's against a fixed wall).
  * It goes into the two objects' bending (F²/2k each) and the contact's plastic work, up to the
    force at which the weaker breaks.
  * Past that, what is left goes into breaking it. If that is more than its catalogue
    `break_energy_j`, it is smashed.
  * Momentum is kept.
  * The rebound is what the springs stored, at most the materials' measured restitution.
* **`scrape(P, Q, {normal_n, slide_m})`.**
  * Each groove, along the slide.
  * What is worn off: the groove's section times its length. A slider on bared grit is also worn
    by Archard's law (K 10⁻²), and the softer of two smooth faces by adhesive wear (K 10⁻⁵).
  * The drag: dynamic friction plus the ploughing of each groove.

### Examples (engine output)

| What | Result |
|---|---|
| Crate (30 kg, enamel over fir) pushed square on into painted stucco at 300 N | Nothing marked; the crate stops. |
| The same at 40° off square (past friction, so it slides) | The wall's paint is cut through, 1.5 mm wide; the render under it is unmarked. The crate's enamel corner is worn through and its wood worn 0.64 mm down. |
| The same corner, dragged at 10 N | A 36 µm scratch in the paint only; a smear of the wall's paint on the crate. |
| Steel corner dragged at 3 kN along the same wall | Paint cut through; render still unmarked (steel is not 1.2 times as hard as the render's sand). |
| Crate corner into the wall at 0.6 m/s | The latex is carried into a 2.5 mm chip in the render; the crate's enamel flakes 11 mm; it stops dead. The same speed square on marks nothing. |
| Plastic crate dragged along a car | A smear of plastic on the paint, no scratch. |
| Trolley wire end along a car at 100 N | A scratch in the clearcoat, short of the steel. |
| Crate corner into a 6 mm window | Holds at 0.5 m/s, cracks at 1.5 m/s, smashed at 3 m/s (past its 60 J). |

### Tests

`tests/mechanics_collide.test.mjs` (16 tests). Each law is checked against the formula or figure
it comes from:

* Every archetype has its layer stats.
* Coats are separate layers.
* The scratch width obeys ASTM G171.
* Tabor's strain and scratch ratio hold.
* A scratch stays in the paint, and the render is grooved only by something harder than its grit
  (corundum).
* A flat face marks nothing.
* Square on it stops, and at a slant past friction it slides.
* The shear-lag flake doubles at half the adhesion.
* Roark break forces (twice as deep, four times as strong) and the plate collapse load hold.
* ½μv² and momentum hold.
* The window cracks at its strength and is smashed past its durability.
* Archard wear doubles with distance.
* The city wiring is in place.

### In the city

While your hands are on something you push (`view.mjs` `stepPushing`):

* **What it runs into.** Its front is checked against the buildings' footprints and the things in
  the street (`pushBlocked`).
* **The first touch** is a blow at the speed it was going (`meetObstacle` → `impact`).
* **After that** it is pressed on with the push you keep up (0.6 of your push).
  * Square on, it stops and you strain on the spot.
  * At a slant past the two surfaces' friction, it slides along the wall, and every 25 cm of
    scrape is drawn on the wall: the paint's own scratch, the render or wood bared under it, or a
    smear.
* **The words** say which layer took the mark.

A building's walls are taken as painted render, unless the place names its cladding; the city's
places carry none yet.

Not yet:

* What a pushed thing does to what it hits is not sent to the world: the marks are this device's,
  and the struck thing's damage is not recorded.
* A pushed thing does not shove another thing along.
* Interior walls (rooms) are not checked.

## Constants

The engine has a handful of named constants (`CONSTANTS` in mechanics.mjs, `CLIMBER` in
climbing.mjs). Each is a physical share or a reporting threshold, not a per-case fudge:

| Constant | Value | Meaning |
|---|---|---|
| `lateral_share` | 0.05 | Share of the front load that bears sideways on a square blow's apex |
| `oblique_lateral` | 0.3 | Extra sideways share per sin(slant) |
| `flank_recovery` | 0.45 | Crushed flank's closing pressure over crush pressure (from NDS withdrawal) |
| `handheld_loss` | 0.2 | Share of a hand-held blow's energy lost in the wrist and handle |
| `micro_flaw_m` | 1 µm | Starting flaw in a brittle solid |
| `scratch_m` | 0.2 mm | Shallower than this, a cut is a scratch |
| `wedge_width_m`, `wedge_ratio` | 3 mm, 0.12 | A cut this wide, and this wide for its depth, is a V kerf, not a slit |
| `wear_coefficient` | 10⁻² | Archard's K for two-body abrasion |
| `chip_tilt_deg` | 30° | Alternate cuts at least this far apart pop the chip between |
| `tree_demand` | 0.015 | Strength share below which an upright tree falls |
| `wet_boundary` | 0.06 | Boundary friction left in a wet, undrained contact |
| `crack_m` | 0.3 mm | A crack this long is reported as a crack, not a chip |
| `noticed_radius` | 2 | An edge is dulled or rolled once its radius has doubled |
| `face_rim_m` | 1.5 mm | The chamfer on a striking face's rim: what a canted face lands on |

## Examples (engine output)

| Case | Outcome | Mark | Depth (mm) | Tool |
|---|---|---|---|---|
| Chef's knife stab, 30 J, green red oak across the grain | cut | slit | 18.8 | none |
| Chef's knife stab, 30 J, dry Douglas fir | cut | slit | 14.1 | none |
| Paring knife stab, 30 J, green oak | cut | slit | 11.7 | none |
| Felling axe, 250 J, green oak | cut | wedge (V kerf) | 16.0 | none |
| Felling axe, 250 J, green white pine | cut | wedge | 19.3 | none |
| Hatchet, 120 J, green oak | cut | wedge | 12.3 | none |
| Splitting maul, 300 J, end grain of a dry oak round | split | split | 23.7 | none |
| Wooden club, 80 J, green oak | dent | dent | 4.5 | none |
| Wooden club, 80 J, 6 mm annealed window | shatter | shatter | — | dented |
| Window punch, 5 J, 6 mm tempered glass | shatter | shatter | 1.1 | none |
| Claw hammer, 50 J, 6 mm steel plate | dent | dent | 0.1 | none |
| Chef's knife stab, 30 J, 6 mm steel plate | bounce | none | 0 | bent |
| Chef's knife stab, 30 J, skin, fat and muscle | through | slit | 112 | none |
| Ice axe pick, 60 J, ice at −10 °C | crack | crack | 27.7 | none |

The force to start piercing skin is 12 N for a chef's knife, 8 N for a paring knife, 1.4 kN for
a screwdriver and 3.2 kN for a butter knife's round end. The published range for a sharp knife is
10–50 N.

| Climb | Holds | Effort | Climbable |
|---|---|---|---|
| Vertical sandstone, jugs, good feet, untrained | yes | 0.24 | yes |
| Vertical granite, 5 mm edges, smearing, untrained | no | 2.39 | no |
| Vertical granite, 5 mm edges, smearing, elite | yes | 0.99 | no (no limb can let go) |
| 35° slopers, chalked | yes | 0.20 | yes |
| 35° slopers, sweaty | no | — | no |
| 35° slopers, chalked, in rain | no | — | no |
| Roof, jugs, strong | yes | 0.41 | yes |
| Vertical ice, no holds, boots | no | — | no |
| Vertical glass, gecko pads | yes | 0.41 | no |
| Granite chimney 0.9 m wide, no holds | yes | 0.39 | no |

## Tests, and how they were kept honest

**`tests/mechanics.test.mjs` (35 tests, CI).** Data integrity and sources, and physical sanity
of every substance. Wood Handbook figures, the hardness ladder, NDS withdrawal, shoe friction
against the catalogue's old friction values, Hertz contact. Section modulus, purity and
determinism, and every material struck by every implement without error. Then calibration
cases:

* A thrown knife, hatchet versus axe, a machete, an apple slice, a sledge on brick.
* Sharpness, abrasive wear, glance angle, withdrawal, splitting along versus across.
* The LP solver, a bar hang, a ladder, a friction slab and the finger-strength range.
* Ice friction against temperature (Kietzig et al. 2010).
* Strength only falling as wood is cut, `climbable`, hold depth.
* An axe edge dulling over many chops and at once on concrete.

**`tests/mechanics_holdout.mjs` (38 tests, run by hand).** These were written before the engine
was tuned against them, and never edited after the first run. The file's SHA-256 is
`ce79751f736ae3e85f01a92ca4f3c8dc4a6a813b56c1ed58cef3b78d25d1ecad`; check it before trusting a
score. It covers knives in wood along and across the grain, steel, glass, axe kerfs, end-grain
splitting, maul versus axe, notch felling, 200 knife stabs not felling a tree, energy scaling,
glancing, sharpness, skin puncture, flesh depth, windows, tempered glass, dents and bruises,
hammer on steel, ceramic versus steel on bone, ice, canvas, a bottle on concrete versus turf,
friction ranges, slopes, and twelve climbing cases.

It is named without `.test.` so CI does not run it: three cases still fail (below), and a
benchmark should report a score, not be bent until it passes. Run it with:

```bash
node --test tests/mechanics_holdout.mjs
```

**First run: 27/38. Now: 35/38.** Every change made after the first run was a general law or a
bug fix, each backed by its own calibration test:

1. **Flat-blade tip thickness.** Tips were forced at least 2ρ thick. Flat blades now use their
   own thickness profile.
2. **Soft solids.** Elastic tissue's wedge pressure was unbounded (5.6 kN to pierce skin). It is
   now capped at the tensile strength, and the dent regime is off for solids that cannot flow.
3. **Blunt contact.** Yield onset at 1.1 Y with Johnson's expanding-cavity hardening and the
   elastic spring-back dent. Before this, a club made no dent in oak.
4. **Notches.** The kerf is kept at its deepest, so fibres cut once stay cut. Strength had risen
   at blow 3.
5. **Section strength.** Fully plastic section modulus instead of elastic. The elastic modulus
   can rise when outer fibres are removed (it is I over the farthest fibre), so strength rose
   when a notch opened.
6. **Ice premelt.** The curve was refitted to the literature. It had given μ 0.28 at −10 °C.
7. **Climbing posture.** The climber picks the best posture instead of using one fixed stance.
   It is sampled finely enough to be within about 1% of the continuous optimum.
8. **Climbing geometry.** A hold stands out from the wall by half its depth, so the hand bears
   out from the face.
9. **`climbable`** added beside `holds`. The meaning of `holds` was not changed to make a test
   pass.
10. **Tool damage.** Damage is judged against the sharpened radius, so wear adds up, and only
    once the radius has doubled. A hatchet had "rolled" on one chop into green oak.

The Hertz unit test moved to 1 µJ, because steel was correctly yielding at the old 100 µJ.

### What still fails, and why

* **A 75° axe blow should glance (holdout 13).** The engine has the blade bite at 75° and glance
  at 85°. Once a wedge is embedded, ploughing friction (about cot β) holds it in the cut. Real
  glancing comes from the first microsecond of contact, the head twisting in the hand, and bark,
  none of which is modelled. Changing the glance law to pass would be fitting.
* **A knife into −10 °C ice goes in 21 mm, not under 15 (holdout 22).** It cracks, as it should
  (crack 0.14 m), and the depth is set by the grip limit and ice's 50 MPa indentation hardness
  (Barnes, Tabor & Walker). I found no measured stab depth in ice to calibrate against, so the
  holdout's 15 mm may itself be the wrong guess.
* **An untrained person holds on 10 mm brick joints (holdout 36).** Foot capacity on an edge
  saturates at 10 mm (`sqrt(depth / 10 mm)`, clamped at 1). On good feet the hands then only
  pull in a little. A sourced figure for how a shoe edges on small holds would fix this. Without
  one I left it.

## Replacing the `vs` table

`rules.json` `tools.kinds[].vs` holds hand-set multipliers (a hammer is 1.6 against glass, 0.3
against steel). With the engine, a strike in the city would become:

1. Look up the target's material, then its `mechanics` substance (catalogue).
2. Look up the held tool's implement (`strike_kinds`, or an item's material for anything else
   swung).
3. Call `M.strike(tool, body, { feature, energy_j, angle_deg, grain, spot })` with the swing
   energy the game already computes from strength.
4. Keep the returned body (marks, strength left) on the object, and the returned tool (edge
   radius, damage) on the item.
5. Break or fell when `broken`. Draw the mark kind and depth. Wear the tool.

The `vs` table and `hurts` can then go. The engine is pure and deterministic, so it can run on
the server (`world.mjs` `strike`) as well as in the page. A strike on a round takes about 3 ms,
most of it the section-strength grid; on a plate or block it takes about 0.02 ms. Blows come at
most a couple of times a second, so neither cost matters. That wiring is not part of this change; see doc 63 for the controls that
would use it.
