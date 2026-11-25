# Every animation in the city, and how real it is (2026-11-25)

This catalogue was written before the animation pass changed anything, so the faults below
describe what was there. A second pass (same day, after the user signed in to Mixamo) replaced
the low scorers the first left: see "Second pass" below. Each row gives the source, the method and the faults. The rating
runs from 1 (reads as wrong) to 5 (reads as real at play distance). The last column is what
this pass does about it; "—" means left for later.

## How people are drawn
| Who | Figure | Motion | Notes |
|---|---|---|---|
| You (the walker) | The avatar creator's MakeHuman body, or the three.js Soldier when no body is built | Three skeletal clips: Idle, Walk and Run (Mixamo, the Soldier's, retargeted). Everything else is **bones turned in code** over the clip (`view.mjs afterPose`, `body-moves.mjs`) | `setAvatarAction` cross-fades only between the three clips |
| People near you (within 30 m, or 26 px tall) | MakeHuman crowd, instanced and skinned on the GPU from clips baked into a texture (`npc-figures.mjs`) | Idle, Walk (5 styles derived on the page) and Run, plus the kitchen's work clips | `figureFits`: anyone down, falling, riding anything but a bike, or making any gesture except phone or film is **swapped to the jointed figure** |
| People further off, and anyone `figureFits` turns away | Jointed figure: rigid torso, head, one-piece legs and arms, with **no knees and no elbows** (`view.mjs drawPeople`) | 22 keyframed clips (`clips.mjs`): stroll, walk_phone, walk_text, walk_carry, walk_bag, limp, idle, wait, talk, phone, film, watch, wave, hail, cower, help, sit, sit_phone, lean_wall, rest, startle, sidestep | Smooth (monotone cubic, cross-fades), but a rigid figure |
| Furthest | Basic shapes | None | — |

## The catalogue
| # | Action | Who | Source and method | Faults found | Rating | This pass |
|---|---|---|---|---|---|---|
| 1 | Stand, walk, run | You | Mixamo clips (Soldier), cross-fade 0.18 s, time scale by pace | Good. The walk-run switch is a pace threshold, with no jog between | 4 | — |
| 2 | **Punch** (X, empty-handed) | You | `body-moves punchPose`, arm bones set in code for 0.36 s | **Snaps** into the guard from whatever the clip had and **snaps** out at the end, with no blend. Only the arm and spine move (no step, no hips, no legs). **Damage needs no contact**: the blow lands on whoever was aimed at if they are within reach + 0.6 m of your centre (2.4 m with the 1.8 m reach), whatever the fist did | 1 | Mocap jab, cross and hook in turn, blended in and out; damage only when the fist reaches the body; a short step in when the target is just out of arm's reach |
| 3 | Swing what is held | You | `body-moves swingPose` in code | Better shaped, but the same snap in and out, and no legs | 2 | Blended in and out; second pass: Mixamo SwingHeld (across) and ChopHeld (two-handed, overhead), the blow landing at the captured moment the hand is furthest out |
| 4 | Thrust (Shift+X), work strokes (saw, pry, cut), push, pick up, strain | You | Bones in code, a `sin(πt)` envelope | Mechanical, symmetric arcs; arms only; the pick-up squat is OK | 2 | Blended in and out; second pass: push and dig are Mixamo captures (PushObject, Dig); saw, pry and cut stay posed |
| 5 | Jump | You | `body-moves` crouch, air and land, in code | Reasonable shape (countermovement, tuck, landing give), but reads as posed (user: "looks unnatural") | 3 | Second pass: Mixamo JumpUp (the take-off, fitted to the crouch), JumpFall (held in the air) and JumpLanding (the knees take it, then up; cut short when you walk off). The clips only bend and stretch: the page's physics lifts the body |
| 6 | Climb | You | IK to holds (`climb-pose.mjs`) | Good: limbs reach real holds | 4 | — |
| 7 | Swim | You | Body laid flat in code over the Idle clip (module 33), a crawl posed over it | Stiff, posed stroke | 2 | Second pass: Mixamo SwimStroke (a breaststroke, lying in the water by itself; faster at a sprint) and SwimTread (upright) |
| 8 | Eat and drink | You | `eat-play.mjs`, hand to mouth in code | Acceptable | 3 | — |
| 9 | Get into or out of a car | You | `car-entry.mjs entryPose`: hips and knees bent in code while slid from door to seat | Plausible sit; the body glides | 3 | — |
| 10 | Sit on a bench or seat | You | Bones in code | Stiff | 2 | — (mocap SitDown, Sit and StandUp added) |
| 11 | **Arrested: walked to the car** | You | `police.mjs` escort calls `placeAvatar` every frame plus `animateWalk` | **Slides**: the page's own movement step puts the clip back to Idle each frame, so the legs barely move while the body glides. Arms are set to the cuffed pose in code | 1 | The escort walk owns the walk clip; cuffed arms laid over it |
| 12 | **Put in the patrol car** | You | `seated_cuffed` pose for 1.4 s, then hidden | **Teleports**: turned to face along the car, legs bent where you stand, then vanish. No step to the door, no duck, no sitting into the seat | 1 | Walked to the open door, ducked and sat in over 1.6 s (mocap SitDown), then out of sight inside |
| 13 | Hands up, cuffed | You | Arms set in code, faded by `f` | Static but readable | 2 | Kept |
| 14 | **Officer runs you down, grabs, cuffs, escorts** | NPC | The officer is a person entry with gesture `grab` or `cuffing`, so `figureFits` is false and they are drawn as the **rigid jointed figure** next to your skinned body. `walkTo` moves them in straight lines **through anyone in the way** | 1 | Grab and cuff shown on the MakeHuman officer (mocap Interact and Push); the officer steps round people; people step aside |
| 15 | **Bystanders at an arrest or a fight** | NPC | Only callers react (`callPlan`: phone out, then call). Everyone else walks on through | No one stops, looks, gives room or films. People stand in the officer's path | 1 | Those near stop and turn to watch; some film; those in the way step back out of it |
| 16 | **Hit by your punch** | NPC | `hit-reaction.mjs` decides flinch, stumble or fall by physics (good), but a `fall` or `down` swaps the person to the jointed figure, and the startle is a jointed-figure clip | The physics is right, the picture is not: a skinned person turns into a rigid one at the moment of impact | 1 | Flinch, stagger and fall shown on the MakeHuman body (mocap HitChest, HitHead, Knockback and Fall, then GetUp) |
| 17 | Talking, waving, hailing a taxi, cowering, helping, startle, sidestep | NPC | Jointed-figure clips | Any of these near you swaps a skinned person to the rigid figure | 2 | Talk, Call (wave and hail), Crouch (cower and help), HitChest (startle) baked for the MakeHuman crowd |
| 18 | Phone, film | NPC | MakeHuman, arm posed over the walk or idle bake | OK | 3 | Phone kept |
| 19 | Sitting, leaning, resting | NPC | Jointed-figure clips | Rigid | 2 | Second pass: sitting (with or without a phone) is Mixamo SeatIdle and leaning on a wall LeanWall, on the MakeHuman body |
| 20 | Cooking line (kitchen) | NPC | Baked work clips (carry, reach, chop, stir, pour) | OK in the kitchen | 3 | — |
| 21 | Cyclists | NPC | MakeHuman, pedals placed by `pedalAt` | OK | 3 | — |
| 22 | Drivers | NPC | Hidden in the car | — | — | — |
| 23 | Pets, birds, rats | Animals | Procedural | Out of scope here | — | — |

## Where better motion comes from (free only)
| Source | Licence | Used? |
|---|---|---|
| Quaternius **Universal Animation Library** 1 and 2, Standard (OpenGameArt, uploaded by Quaternius) | **CC0 1.0**: free for any use, no credit needed (credited anyway) | **Yes.** 41 clips retargeted (`tools/avatars/build_moves.py`) onto the crowd, avatar and Soldier skeletons, in `docs/city/models/moves/` |
| Epic Game Animation Sample (500+ clips), Lyra, Paragon packs | Free, but under the Unreal Engine EULA, for **Unreal Engine products**. The web game is not one | Not for the web game. Usable in the Unreal port (`unreal/`), and it needs a Fab download from your Epic account |
| Mixamo | Free with an Adobe account; royalty-free in a game; raw files must not be redistributed | **Yes (second pass)**, through your sign-in: 11 clips exported skeleton-only (X Bot, 30 fps), retargeted by the same script and baked into the moves files. The raw FBX files are kept out of the repository |
| Reallusion ActorCore free clips | Free with an account; licence per clip | Not needed: Mixamo covered every action this pass replaced |
| MoCap Online | Paid | Excluded |
| NVIDIA Komodo / UE 5.9 text-to-motion; video-to-motion tools | Editor tools; output licensing varies | Not used: Unreal-side, or uncertain licences |

## Second pass (2026-11-25)
- Mixamo clips (sign-in in the in-app browser, exported through Mixamo's own site, skeleton only)
  are retargeted with `tools/avatars/build_moves.py --mixamo <folder>`. Their rest pose is the
  T-pose the retarget starts from. `tools/avatars/thin_moves.py` then drops the keys a straight
  (shortest-arc) line reproduces within 0.002 rad or 1 mm, and the channels that never leave rest:
  the files went from 4.3 MB to about 2 MB each with 11 more clips, and play the same.
- Not found on Mixamo: hands up or cuffed (kept posed), and nothing better than the posed
  eat/drink for a held item. Car entry and exit clips exist (Entering Car, Exiting Car) but are not
  used yet: they need the body moved through the door by the clip.

## What is still procedural
Left as they were: sit (you: the view is from your eyes when seated), eat, the climb IK, the saw,
pry and cut strokes, the pick-up squat, hands up and cuffed, getting into a car, the jointed
figures far off, and the animals.
