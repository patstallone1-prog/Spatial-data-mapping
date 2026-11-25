# Law, police and the courthouse: crimes are charged only when someone catches them

Code: `docs/city/law.mjs` (the world's side, pure helpers + commands), `docs/city/police.mjs` (callers,
squad cars, pursuit, arrest), `docs/city/courthouse.mjs` (the building and the hearing's script),
`docs/city/court-session.mjs` (going there, the hearing played, coming back). Numbers: `rules.json` → `law`.
Tests: `tests/city_law.test.mjs`, `tests/city_courthouse.test.mjs`.

## Offences, not instant fines
Speeding past a police witness, hitting a car or a person, theft, vandalism, a shove, a punch or a beating
no longer fine you on the spot. The world records an **offence** (`W.offence`, kept on `p.offences` for
`offence_life_min`) and charges it only when it is caught:

| Caught by | Command | What happens |
|---|---|---|
| A witness or the victim who got through on the phone (≥ `call_s` = 10 s) | `report_crime` | With a plate and a minor crime the fine is mailed to the plate's owner; otherwise police are dispatched |
| A speed or red-light camera | `speed_camera` (unchanged) | Fine at once |
| An officer who stops you | `police_stop` | Citation, or arrest for arrestable crimes |
| An officer who read your plate while you drove off | `plate_read` | Fine + evading, with a summons |
| Police who lost you | `police_lost` | A victim's statement for severity ≥ 3 becomes a summons; anything else is dropped |

## Who calls, and how often
`reportOdds(crime, who)` weights the call by how grave the crime is: speeding is almost never reported
(bystander odds 0.008), a beating always is (victim 1). Callers really take their phone out (the `phone` clip,
1.5–4 s to get it out) and must stay on it for 10 s; a victim who fought back waits until you are
`victim_waits_m` away before calling. Interrupt them (hit them, or they lose sight of what to report) and
the police never hear.

## Squad cars
Units come from tracked fleet patrol cars, or from SFPD Northern Station (1125 Fillmore) when none is free,
and drive the street graph at `sirenSpeed` (limit × `traffic_factor`, within `siren_ms`), so they arrive
when the drive takes, not instantly. Patrol bodies are the Sonata GLB painted with `PATROL_LIVERY`
(black-and-white doors, gold star). Light bars are additive sprites (no real lights, so no shader
recompiles); the siren is WebAudio.

On arrival they search for `search_s`. If they see you (`sees_m`) they pursue along your trail:
- Driving away: within `plate_m` for `plate_s` they read the plate (fine + evading + summons for resisting).
  Further than `lose_m` for `lose_s`, or after `give_up_s`, they lose you.
- Stopping (under `pull_over_ms` for `pull_over_s`): an officer walks up. For an arrestable crime they
  run, and you raise your hands, are cuffed, walked to the car and seated in the back. The car drives off,
  and once it is `out_of_sight_m` away (or after `out_of_sight_s`) you are back at home or your spawn point,
  with the arrest on your record and a court date `court_days` out.

## The courthouse
The Superior Court's Civic Center Courthouse (400 McAllister St) is outside the city's map, so the summons
message and the to-do entry carry a **Go to the courthouse** link (`goToCourt`). It builds the courthouse
under you, hides the city and puts you in the corridor. You may walk the whole floor (lobby, corridor,
Department 12, the jury deliberation room, chambers, holding, the jury assembly room, two conference rooms,
the clerk's office); the street doors are held by a deputy. In court the street's prompts, hints, keys,
taxis and building doors are off.

Department 12 has the judge's raised bench with gavel, seal and flags, the clerk and reporter, a witness
stand, a 14-seat jury box on two tiers, prosecution and defence tables, a lectern, the bar and gate, and
pews for 100+. `castOf` fills the essential roles; the public is `spectatorsFor(severity)`: none for a
traffic ticket, a few for battery, a full house for attempted murder. `hearingOf` scripts the beats (all
rise, called to order, witnesses called and stepping down, the charge, the jury out to deliberate and back,
the verdict, the sentence, adjourned) from the case file. Space moves a beat on. On `court_conclude` the
penalties are applied and you are put back where you stood.

## Phones
`phone_store` is a shop kind (smartphones, cases, chargers, headphones, power banks). Apple Chestnut
Street, Verizon, T-Mobile, AT&T and the other carriers are matched to it by name. The online shop already
sold smartphones.
