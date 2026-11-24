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
| `substances` (56) | Wood species green and dry (Douglas fir, white pine, red and white oak, sycamore, white ash, decayed softwood), metals (mild, knife, axe and tool steel, aluminium, cast iron, chromed steel), glass (annealed, tempered), ceramics, stone, concrete, brick, stucco, ice, polymers, rubber, fabric, paper, board, plasterboard, tissue (skin, fat, muscle, cortical bone), apple, soils, leaf, water. Each has density, E, ν, yield/UTS/compressive strength, hardness, fracture toughness or energy, grain (for wood: across- and along-grain values), brittleness and a surface (smoothness, texture, surface energy), with its sources. |
| `implements` (20) | Chef's, paring, butter and ceramic knives, machete, felling axe, hatchet, splitting maul, claw hammer, sledge, rubber mallet, wooden club, aluminium bat, crowbar, screwdriver, nail, window punch, ice axe, glass bottle, fist. Each gives its substance, mass, strike mass, grip limit and the geometry of its edge (radius, thickness profile back from the apex, contact length, the deepest the head can go), tip (radius, width and thickness profiles) and face (curvature and size). |
| `contactors` (10) | What touches a surface to hold or slide: dry, chalked and sweaty skin, a glove, shoe rubber, climbing rubber, a boot, a leather sole, gecko-type pads, bare steel. Each gives adhesion, hysteresis, base friction, moisture and contact area. |
| `item_materials`, `strike_kinds` | Which substance a city item of each material kind is, and which implement each existing tool kind in `rules.json` is. |
| `sources` (26) | Every source cited, by key. |

Every existing catalogue material names its substance in a new `mechanics` field (`green_wood` →
`sycamore_green`, `lumber` → `douglas_fir_dry`, `glass` → `glass_annealed`, `none` → null). The
Python loader checks the section (`smc.world.catalogue.mechanics_problems`): every material's
substance exists, every implement names a substance, every contactor states its friction terms,
every strike kind names an implement, and every cited source is listed.

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
