# The city's server

Until 2026-11-15 the city's books (`CityWorld`: money, property, businesses, inventories, laws,
messages) lived in a browser -- yours alone, or a party host's, elected by the lowest id and
broadcast whole to the room. Anyone could act as anyone, bring a balance in from a saved game,
describe a building as smaller than it is, or read everyone's state off the wire; two hosts made
two histories. Now there is one world, kept by a server, and a browser is a client of it.

## What decides what

| | where |
|---|---|
| The world's rules (funds, reach, inventory, title, taxes) | `docs/city/world.mjs`, unchanged in substance, run by the server |
| Who is asking | `server/city/auth.mjs`: a session token signed by the server for a device account; the player id is read from the token, never from a command |
| What may be asked | `server/city/guard.mjs`: plain bounded data, self-reported numbers clamped, a rate, and a position that is on the map and within reach of where the server last saw the player (70 m/s and 90 m of slack) |
| What a place is | `server/city/canon.mjs` + `server/city/canon/marina.json`: a command names a place by id; position, floor area, floors, use, the week's home listings and their prices, and a shop's rivals are the server's record |
| The command loop | `server/city/authority.mjs`: load, step to the server's clock, check, run on the loaded copy, commit whole by compare-and-swap -- or keep nothing |
| What a player is shown | `server/city/views.mjs`: their own books in full; of others, the public record only |
| Where it is kept | `server/city/storage.mjs`; deployed: Supabase, `supabase/kerbside_city_server.sql` |
| The door | `server/city/http.mjs`; deployed as the Vercel function `api/city.mjs` at `/api/city`; on one machine `node server/city/serve.mjs` |
| The page's side | `docs/city/server-client.mjs`, and the books section of `docs/city/view.mjs` |

One request is one JSON POST: `{op: "session", key}`, `{op: "cmd", token, req, command, args}`,
`{op: "sync", token, since}`, `{op: "grants", token}`.

## Setting it up (once)

1. Paste `supabase/kerbside_city_server.sql` into the Supabase SQL editor (after
   `kerbside_city_grants.sql`). Its last statement prints `KERBSIDE_CITY_SECRET` **once**.
2. In the Vercel project: Settings -> Environment Variables -> add `KERBSIDE_CITY_SECRET` with
   that value (Production), and redeploy.

Until both are done `/api/city` answers 503 `not_configured` and every page plays its offline
practice world, saying so in the You panel ("offline practice ... nothing here is kept in the
city"). `GET /api/city` says whether the server is up.

## What the page does now

* **City mode** (the Marina): signs in with the device's account secret, over HTTPS, to its own
  origin's `/api/city`; joins; sends each action; shows the server's answer; asks what changed
  every 4 s. It holds no books and saves none.
* **Explore, a development page, or a server that does not answer**: an offline practice world
  of this browser's own (the old solo save). Nothing in it is ever sent to the city: there is no
  import, and leaving a party reconciles nothing.
* **A party** is who you see walking. Peers say which city player they are so you can pick them
  to pay or write to; that is a name to choose from, never a proof.
* Backend grants (`kerbside_city_grants`) are paid by the server, in the same commit that marks
  them claimed. Pages can no longer read or claim them.
* Existing local balances do not carry over: everyone starts in the one world with the starter
  grant.

## The place record

`tools/build_city_canon.mjs` writes `server/city/canon/marina.json` from the page's own district
(the header says how to dump it), keeping the City area and a 200 m margin -- inside the area
every page builds the same places. Run it again when the district's buildings change; a place
the record does not hold is refused ("the city has no record of that place").

## Development

    KERBSIDE_CITY_SECRET=dev KERBSIDE_CITY_STORE=file:.city/world.json node server/city/serve.mjs 8790
    # then open the local page with ?cityServer=http://localhost:8790/api/city

(`?cityServer=` is honoured only on a local page and only for a local address.) Tests:
`tests/city_server.test.mjs`.

## Known limits

* What only the page can see is still the page's word: speeding, tolls, lane use, collisions and
  the number of witnesses are reported by the player's own browser. A changed client can leave
  its own offences out; it cannot make money or property by doing so.
* NPC traffic is simulated in each browser, so crashes between NPC cars no longer change the
  shared world.
* The server does not test a position against walls; it tests the map's bounds and speed.
* The world is one record, loaded and written whole for each command, with compare-and-swap
  between instances. That is right for tens of players; past that it wants splitting by player
  and by block, and the page wants a push channel instead of asking every 4 s.
* Sessions last 12 hours and are not revocable one by one; replacing `KERBSIDE_CITY_SECRET`
  ends them all.
