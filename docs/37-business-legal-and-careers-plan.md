# 37 — Businesses, the law and careers: the plan

How a player starts, buys and runs a business and directs the NPCs who work in it; how a player
charged with something hires a lawyer and goes to court; and how a headhunter finds a player a
better job. Planned on 2026-11-11 from what the city already has (docs/city/*.mjs, rules.json).
Built on 2026-11-12 in `docs/city/enterprise.mjs` (the world) and `docs/city/enterprise-panels.mjs` (the panels), tested in `tests/city_enterprise.test.mjs`; see §7 for what was built and where it differs from the plan.

## 0. What the city already has to build on

| Piece | Where | Used for |
|---|---|---|
| Ledger with player, business and authority accounts; tax withholding; transfer tax | `core.mjs`, `world.mjs` | every payment below |
| Building registry: buy from an NPC landlord at the appraisal, sell | `world.mjs` `cmd_buy_building`, `appraise` | buying premises |
| Leases (a month ahead, a month's deposit, evicted after two missed) and a storefront lease rate | `rules.json` `real_estate.lease`, `business.storefront_lease_per_week` | renting premises |
| Store kinds and stock per kind; tenants told by name (`stores.tenants`) | `rules.json` `stores`, `core.mjs` `shopKinds` | what a business sells |
| Jobs: roles, pay, shifts, workplaces; take a job, clock in and out, tasks every minute or so, paid every ten minutes worked, sent home after 30 idle | `rules.json` `jobs`, `work_tasks`; `world.mjs` | staff, and the player's own work |
| NPC roster with homes, roles and workplaces, by district | `people.mjs`, `fleet.mjs` `Roster` | the people a business can hire |
| Fines, citations, a contest with a hearing; witnesses (camera field of view) | `rules.json` `fines`, `enforcement`; `enforcement.mjs` | the cases that go to court |

## 1. Jobs (done in this change, and what follows)

Done:
- The Shop has a **Jobs** tab: the openings at the places around you. Each role is listed at its three nearest workplaces, with the pay, the shifts and the distance. Apply, or switch from the job you have.
- The **to-do list** now carries work:
  - with no job: "Find a job", which opens the Jobs tab;
  - with a job, during a shift: "Go to work … clock in there", with the arrow;
  - at the workplace: "Clock in", also a button on the action bar;
  - clocked in: "your next task is coming" between tasks;
  - each task in turn (V, where the orange ring is).
- Shops no longer list hiring themselves; their panel points to the Shop's Jobs tab.

Next:
- **Shift reminders.** A to-do entry 30 minutes before a shift starts. A late arrival is docked once and logged.
- **Experience.** Count each completed task against the role (`p.experience[role]`) and track shifts completed and on time (`p.reliability`). These feed promotions (§4) and headhunters (§4).
- **Promotions.** After 20 shifts with reliability ≥ 0.9, a role steps up a level (Shop assistant → Senior shop assistant → Shift lead), +12% pay a level. Levels are kept in `rules.json` per role.

## 2. Running a business

### 2.1 Starting one

1. **Premises.** Lease a vacant storefront (the lease rules above), or buy the building outright (`cmd_buy_building`); a home with a shop on its ground floor (`use:retail`) counts.
2. **Register it.** `cmd_register_business {place, kind, name}`. The name is free text, checked against the map's real tenant names and refused if it matches one (no impersonating a real shop). The kind is one of `stores.kinds`, and it decides the stock, the roles to hire and any licence.
3. **Licences**, as fees paid to the city treasury, renewed yearly:

   | Licence | Needed for | Fee |
   |---|---|---|
   | Business registration | every business | 91 |
   | Health permit | food kinds | 380–1,100 by size |
   | Liquor licence | bar, liquor store, wine shop | 1,200; transfer one from a closing business for 15,000 |

   These are approximately San Francisco's schedule.
4. **Opening stock.** Ordered from a wholesaler (§2.3). The till starts empty: the owner funds the business account from their own.

### 2.2 Buying one

Every NPC-run shop on the map is a business with an owner (`business:<place id>`, already in the ledger) and an asking price:

- **Asking price** = 2.5 × the trailing year's profit + stock at cost + 0.25 × annual rent saved if the building comes with it. A shop with no profit is asked its stock and a key fee.
- **Profit** is modelled from the place's customers (§2.4): visits × conversion × average sale × margin − wages − rent.
- **Seller financing:** 30% down, the rest over 24 months at 8%. A missed payment twice returns the business to the seller.
- **Due diligence:** the panel shows the last 12 weeks' books (modelled) before buying. A headhunter or a lawyer can be paid to check them (§3, §4).

### 2.3 Operating it

- **Stock and prices.** Each item has a wholesale cost (45–60% of the list price by kind). Orders arrive the next morning by delivery truck: a real truck, from fleet.mjs, at the kerb. The owner sets a price from 0.8× to 1.6× list. Demand falls with price (elasticity −1.2 for groceries, −0.6 for prepared food), so the margin is a real choice.
- **Hours.** Open and close times. Customers come only while it is open, and wages are paid only for shifts.
- **Books.** A daily P&L, as ledger entries on the business account:
  - sales, and the sales tax collected and remitted;
  - cost of goods;
  - wages, and the payroll taxes withheld (already modelled);
  - rent.

  A weekly summary goes on the to-do list.
- **Quality and reputation**, 0–100: staffing at peak hours, stockouts and cleanliness tasks done. It moves conversion (§2.4) and is shown as a star rating on the shop's panel.

### 2.4 Customers

The NPCs' days already send them to places by kind (`people.mjs`: meals, errands, evenings). A business's share of those visits:

```
visits     = the district's visits for its kind × attractiveness / Σ attractiveness of the same kind within 600 m
attractive = reputation^0.8 × (1 / price factor)^elasticity × open-hours overlap
conversion = 0.35–0.8 by kind, × staffing at that hour (an understaffed counter loses customers)
```

Players can buy there too, at the owner's prices. That revenue goes to the owner.

### 2.5 Directing NPC workers

- **Hiring.** The staff panel lists candidates: the roster's unemployed (`role: unemployed`) and people in lower-paid jobs within 3 km, each with a skill (0–1), a reliability score and the wage they ask, at least the minimum wage. A headhunter (§4) finds better candidates for a fee.
- **Schedules.** Shifts are drawn on a week grid. An NPC works the shifts given; their own day (people.mjs) fits round them, as it does now.
- **Orders.** Duties, by priority:
  - serve the counter;
  - restock;
  - clean;
  - make deliveries (the delivery gig, run by staff);
  - open or close.

  An NPC on shift picks the highest-priority duty that is due. These are the same work tasks the player does when clocked in (`work_tasks`), done by the NPC at their speed × skill.
- **Live commands.** Standing in the shop, the owner can point at a staff member and choose "Serve the queue", "Restock the shelf", "Take a break" or "Go home". The order goes to the front of that person's queue.
- **People, not machines:**
  - morale (0–100) falls with understaffed shifts and pay below the going rate, and rises with raises and breaks;
  - below 30, an NPC is late; below 15, they quit, with a week's notice;
  - firing pays out the shift worked and the accrued holiday pay.
- **Data:** `registry` asset `business:<id>` = `{place, kind, name, owner, account, stock, prices, hours, staff: [{person, role, wage, shifts}], reputation, licences}`.
- **Commands:**
  - `cmd_register_business`, `cmd_buy_business`;
  - `cmd_order_stock`, `cmd_set_prices`, `cmd_set_hours`;
  - `cmd_hire`, `cmd_fire`, `cmd_schedule`, `cmd_order_staff`;
  - `cmd_close_business`.

  All are pure world commands, tested the way `city.test.mjs` is.

## 3. Law offices, lawyers and court

### 3.1 Where

A **law office** is a store kind (`law_office`) that the tenant rules give to offices named "Law Offices", "Attorney", "LLP"… Today the office rule makes those no shop at all; it moves them to `law_office` instead. Inside, the counter's panel shows the firm's lawyers. The courthouse is the civic building nearest the district's real one (in SF, 400 McAllister); the hearing is held there.

### 3.2 The lawyers: invented, never real

The office's real name is the building's. Its lawyers are invented people:
- a name from the roster's name lists;
- a firm-style surname pair, refused if it matches any real tenant name in the region;
- a seeded, fixed role and record for each.

| Role | Takes | Base fee |
|---|---|---|
| Public defender | criminal, free if your balance is under 2,000 | 0 (busy: 1 hearing of prep) |
| Traffic and citations | speeding, red light, parking, tolls | 150 |
| Criminal defence | theft, battery, vandalism, trespass | 900 |
| Civil and business | leases, a business dispute, an injury claim | 1,400 |
| Property | evictions, sales, title | 1,100 |

Each lawyer has:
- years in practice, 1–35;
- skill, 0–1. It is never shown directly; it shows in the record;
- a record: cases, wins, pleas and losses. It is drawn from skill (wins ≈ Binomial(cases, 0.25 + 0.55·skill)), so the record is honest about the skill;
- a **price** = base × (0.6 + 1.4·skill) × (1 + years/40), rounded to 25.

The player sees name, role, years, record and price, and chooses.

### 3.3 A case

1. **Charge.** A fine or a criminal charge from the existing enforcement (witnessed offences only). It opens a case: `{charge, evidence (0–1: camera footage 0.9, an NPC witness 0.6, none 0.3), priors (the player's record), due}`.
2. **Options:**
   - pay (closes the case, and a record line for criminal charges);
   - contest yourself (the existing hearing);
   - hire a lawyer (retainer at their price, paid to the firm's business account).
3. **Court date.** 2–14 in-game days, on the to-do list with the courthouse marked. If the player doesn't come, the hearing goes ahead in absentia at half the lawyer's skill.

### 3.4 The verdict (this version: weighted chance)

The possible outcomes for the charge, most favourable first (`f` from 1 to 0):

| Outcome | f | Base weight |
|---|---|---|
| Dismissed | 1.0 | 0.10 |
| Acquitted | 0.9 | 0.10 |
| Reduced charge, lower fine | 0.7 | 0.20 |
| Plea: fine as charged, no record | 0.5 | 0.20 |
| Fine as charged, on the record | 0.3 | 0.25 |
| Fine + probation (a month; a second offence doubles) | 0.15 | 0.10 |
| Jail (hours of game time at home, no work, no driving) | 0.0 | 0.05 (criminal only) |

Each weight is tilted by the lawyer and the case, then all are normalised and one is drawn:

```
w_i = base_i × exp( k × (skill − 0.5 − 0.4·(evidence − 0.5) − 0.15·priors) × (2·f_i − 1) ),   k = 2.4
```

- A skilled lawyer shifts weight to the favourable end; strong evidence and priors shift it back.
- With no lawyer, skill is 0.25 (contesting yourself).
- With skill 0.9 and evidence 0.5, dismissal or acquittal is ≈ 38% and a fine on the record ≈ 12%. With skill 0.3 they are ≈ 12% and ≈ 34%.
- The panel shows the lawyer's odds before you hire: **"likely", "even" or "unlikely"** for a good result, never the exact numbers.

### 3.5 The record

- Lines on `p.record` (`{charge, outcome, at}`). Pleas and dismissals leave no line.
- Effects:
  - some roles check it: pharmacist, security guard, bank teller and teacher refuse a theft or battery within 2 game-years;
  - priors raise the price of a criminal defence, and tilt verdicts (§3.4);
  - a headhunter's offers are fewer with priors (§4).
- An **expungement** service at a law office clears lines over 2 game-years old (Civil, 600).

## 4. Headhunters and careers

- **Where.** Staffing agencies are a store kind (`staffing`), by name: "staffing", "recruit", "employment agency", "talent". Their counter has a recruiter. An agency can also be called from the Shop's Jobs tab ("Ask a headhunter").
- **What they do.** Given your experience (§1), reliability and record, the recruiter looks across the district's openings. These are `jobs.roles` at places within 5 km, plus roles one level up from yours that you qualify for. The recruiter offers the three that pay best, each ≥ 10% above your current pay.
- **Fee:** 10% of the first month's wage, from your pay as it comes, or nothing if the employer pays: a business owner using a headhunter to hire pays 15% (§2.5).
- **Offers** appear on the to-do list ("A recruiter has a job for you: Shift lead at …, 1,010/h") and expire in two game-days.
- **Players' businesses** can post openings, which then show on the Jobs tab and through headhunters for other players in a party.

## 5. Order of work

1. **Business core:** `cmd_register_business`, stock and prices, books, customers' share (§2.1, §2.3, §2.4). Tests: a shop's week of books balances; demand responds to price.
2. **Staff:** candidates, hire, schedules, duties, morale; NPC staff on the work-task loop (§2.5). Tests: a shift is staffed; a quit after low morale; wages and payroll balance.
3. **Buying NPC businesses** and seller financing (§2.2).
4. **Law:** the `law_office` kind, invented lawyers, cases from fines, the weighted verdict, the record (§3). Tests: the weights' tilt is monotonic in skill; lawyers' names never equal a tenant's.
5. **Careers:** experience, promotions, headhunters (§1, §4).

Each step is pure world commands in `world.mjs` with rules in `rules.json`, and the panels in `view.mjs`, as the jobs and the shop are now.

## 6. Decisions (answered 2026-11-12)

- **Jail: a time skip.** No hours at home. The sentence passes at once, and the player gets a summary of what happened to them inside. They come out with health, stamina and strength changed to match that story (a fight, the yard, the infirmary, a work detail). The crime goes on the record, and so does "former inmate".
- **Party worlds.** One player can be another's **employee** (staff records take a player's id). One player can **not** be another's lawyer while verdicts are this weighted chance; that waits for a real legal system.
- **Harshness: yes.** A fine left unpaid past its late penalty becomes a court case.

## 7. Built (2026-11-12)

All five steps of §5, as pure world commands installed on `CityWorld` (`installEnterprise`), with the rules under `rules.json` `business` (money only under the money keys: `fee_base`, `balance`).

- **Premises and registering:** `lease_storefront` (a vacant storefront: a place for shops with no shop in it), or a building you own; `register_business` refuses a real tenant's name (the view tells the world the map's tenant names, `knowTenants`) and the two counter kinds; licences are paid to the city at registering and renewed yearly from the till.
- **The hour by hour:** `hourOf` — customers by kind and hour (`hour_curves`: food, grocery, retail, night), shared with rivals within 600 m, drawn by reputation and put off by price (`price ^ elasticity`); the staff on shift work the duties in the owner's order (an order to one of them goes first); what sells comes off the shelves. The day closes at midnight: takings in (`npc_income`), sales tax out to the city, wages paid with taxes withheld (to `business:residents`; a till that cannot pay owes a bill), reputation and morale moved, a line in the books, and on Mondays the week's summary.
- **Wages at a player's business are real San Francisco wages** (`staff.wage_scale` = 19.18 / 720): the shop's prices are real ones (a coffee 8), while the jobs' pay is on the V2 vision's scale (720 an hour the floor). At V2 wages no shop could ever pay its staff.
- **Staff:** seeded candidates (skill, reliability, asking wage), a headhunter's better ones for 15% of a month's wage; schedules (a new hire fills the least-covered hours), live orders in the shop (serve, restock, clean, break, go home), raises; morale below 30 is late for the first hour, below 15 gives a week's notice; firing pays the day and the holiday accrued. A player can be hired (an offer, or an opening on the Jobs tab) and is paid from the business's own account.
- **Buying an NPC's shop:** `appraise_business` models 12 weeks of its books; asking 2.5 × a year's profit + two weeks' stock at cost (or stock + a key fee); 30% down, 24 monthly payments at 8% to the seller; two missed and it goes back.
- **Law:** `law_office` and `staffing` store kinds told by name (tenant rules before the office rule); 3–5 invented lawyers an office (`lawyersAt`), never a real tenant's name, a record drawn from the hidden skill, odds shown as likely / even / unlikely; every fine opens a case; hiring a lawyer sets a court date (2–14 days; a public defender two more); `attend_court` decides it (plan §3.4's weights); missed, it is heard without you at half the skill; an unpaid fine past its late penalty becomes a summons. Probation doubles a second fine. Record checks for pharmacist, security guard, teller and teacher. Expungement 600.
- **Court location:** the city's play area is the Marina (City mode is locked to it), so hearings are held at the district's civic building nearest the real courthouse (400 McAllister St), as §3.1 allowed.
- **Jail:** a time skip told as up to 8 dated events (`jail_story`), each moving health, stamina and strength; the crime and "former inmate" go on the record; 7 days or more costs the job.
- **Careers:** experience per task, shifts on time (late past 10 minutes: docked 15 minutes' pay once), a promotion after 20 shifts at 90% on time (+12%, titles in `careers.levels`), a recruiter's three best offers within 5 km at 10% more (fewer with priors), the fee taken from pay as it comes.
- **Panels:** the Shop gains Business and Law & record tabs; a business panel (overview, stock & prices, staff, hours & duties, books); the shop panel offers to buy the business; law offices and staffing agencies open their own panels; the to-do list carries shift reminders, court dates, recruiters' and players' offers, weekly summaries and stock-outs; the action bar offers a vacant storefront's lease and your hearing.

Not built: the wholesaler's truck at the kerb (stock simply arrives at 07:00), NPC visitors walking into a player's business (its customers are modelled, not drawn), and liquor-licence transfers.
