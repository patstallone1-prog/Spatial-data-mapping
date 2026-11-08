# Kerbside V2 — the living-city simulation core

`smc.city` is the authoritative world the V2 vision runs on. It holds the money, who owns and
who holds every thing, the laws in force, the government, the 1,000 NPCs of a district, the
cars on its streets, and the one command API players act through. It is plain Python with no
dependencies and no I/O apart from loading a region payload. The server, the client rendering
and the database are layers that will sit on top of it.

```bash
python -m smc.city --hours 6                                   # the synthetic grid district
python -m smc.city --payload docs/sf-corridor-3d.json --hours 24 --npcs 1000 --players 3
pytest tests/test_city_ledger_property.py tests/test_city_law_world.py
```

On the real SF corridor (25,862 street nodes, 15,986 places, 33,365 registered assets) a
simulated day with 1,000 NPCs takes about 4 s on the Mac.

## Rules every module keeps

* **Money is one placeholder currency, Credits (`₡`, code `KCR`), held as integer minor units.**
  Only `currency.py` knows its name, symbol and decimals. Replacing it with the final currency
  is a one-file change; nothing else may hard-code "₡" or assume two decimals.
* **The ledger is double-entry.** Every entry sums to zero and applies whole or not at all.
  Nothing overdraws except the issuer. Money is only made (`mint`) or destroyed (`burn`) for a
  reason listed in `ledger.MINT_REASONS` / `BURN_REASONS`. A repeated request with the same
  idempotency key pays once. The balances can always be rebuilt from the journal.
* **Title and possession are separate.** Owner, possessor and custody (`owner`, `loan`, `lease`,
  `stolen`, `impounded`) are tracked apart. Theft moves possession, never title. Every change is
  a `Transfer` in the asset's history.
* **Laws are data the world executes,** built only from the bounded rule kinds in
  `law.RULE_KINDS`. That list is the platform limit: no law can mint money, ban a player or go
  outside the bounds.
* **Players act only through `World.submit(player, command, **args)`.** It acts as that player
  only, on what is theirs, and never raises; a refusal comes back as `{"ok": False, "error": …}`.

## The vision, piece by piece

| Vision section | Status | Where |
|---|---|---|
| Currency (placeholder, to be replaced) | **Done**: Credits in minor units, formatting, parsing | `currency.py` |
| Economy: ledger, issuance and sinks | **Done**: double-entry, mint/burn reasons, idempotency, replay, audit `check()`. NPC savings cap and upkeep burns keep the money supply level | `ledger.py`, `world.py` |
| Transfer of possession and personal property | **Done**: register, gift, sell (money, title and tax in one entry), lease (rent up front), lend, return, theft, police recovery, impound/release, seizure with a stated basis. Goods by quantity with purchases | `property.py` |
| Player offers | **Done**: offer, accept (once), decline, withdraw; gift, lend, lease and return between players | `world.py` (`_cmd_*`) |
| Starting a player | **Done**: ₡2,000 grant, a rented room leased free for a week, residency registration, no car, starter job paying per 10 minutes | `world.py`, `params.py` |
| Law system | **Done (starter set)**: jurisdictions (region › county › city), versioned laws, effective dates, repeal, nearest jurisdiction wins. Rule kinds: tax rates, speed limits, parking fees, zoning, fines, restricted items, licence fees. Enforcement needs evidence, fines are paid into the treasury and any unpaid part is owed | `law.py` |
| Real zoning | **Done (first approximation)**: each SF zoning district on the map becomes a zoning rule | `district.py` |
| Government | **Done (core)**: residency to vote (7 days), minimum electorate, mayor plus 5 council seats, 2-week terms, proposals by office holders, 3 of 5 to pass. An NPC administration runs a city with no elected government | `government.py` |
| NPCs | **Done (core)**: 1,000 per district with the designed role table, homes, workplaces and shift schedules. They commute, work, are paid by their employer, shop, eat out, pay rent to the building's owner and buy restock wholesale | `npc.py`, `world.py` |
| NPC movement | **Done**: street graph from the region's ways with one-way streets and road classes, A* routing, lawful speed × congestion (BPR) | `streets.py`, `agents.py` |
| Cars and traffic | **Done (core)**: vehicle catalogue with prices, fuel and capacity; a dealership (new cars are built outside the economy); used-car prices; fuel costs; NPC traffic by hour and mix, kept denser around players; parking lots with fees; impound after 3 unpaid tickets; speed cameras | `vehicles.py`, `world.py` |
| Crime and policing | **Started**: theft with witnesses and alarms, fines, police NPCs dispatched to recover property, speeding and parking enforcement | `world.py`, `law.py` |
| Businesses | **Started**: every shop on the map is a business with a till, stock and shelf prices; owners set prices and restock | `district.py`, `world.py` |
| Snapshots | **Done**: the world's records (ledger journal, registry, laws, government, fines) round-trip through `snapshot()` / `World.restore()` | `world.py` |

## What comes next (not built yet)

* **Server**: an authoritative process that owns a `World` per district, steps it in real time
  and accepts `submit` commands from signed-in players (Supabase auth). The command API was
  designed for this.
* **Persistence**: an append-only store (Postgres) for the ledger journal and property
  transfers, with snapshots for the rest. `Ledger.from_dict` already rebuilds balances by
  replaying the journal.
* **Client**: draw NPCs and cars in the viewer from the server's `near()` set; dealership,
  wallet, offers, law and voting panels.
* **Courts**: trials, appeals, sentences beyond fines. Today an offence is fined straight away.
* **Construction and destruction**: building permits are checked by `LawBook.permits_building`;
  the build/damage/repair flow itself is not written.
* **Markets**: property listings, auctions, a used-car market beyond player-to-player offers.
* **Balancing**: the city's payroll currently exceeds its tax income, and an administration
  grant (`mint public_contract`) fills the gap. Pedestrians near players fall below the
  40–100 target on the sparse multi-district corridor.
* **The final currency** replaces `currency.CREDITS`.
