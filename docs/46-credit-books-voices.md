# Credit, business books, court play, spawn points and the voices of the city

What this pass added, where it lives, and what it needs to be switched on.

## Loans and the credit score (`docs/city/credit.mjs`, rules.json `credit`)

- **The score** runs 300 to 850 on the usual weights: payment history 35%, what is owed against free
  cash and assets 30%, length of history 15%, recent applications 10%, kinds of credit 10%. It is never
  stored. It is worked out from the world's own records (bills and instalments paid on time or late,
  balances, the journal's money in and out), so it can only be earned.
- **Bankers.** A bank (map key `shop:bank`) has three desks: small loans and medical bills, home loans,
  business and vehicle lending. You must be in the bank and ask the banker whose desk it is; the wrong
  one sends you to the right one by name. The banker reads the score, the last month's money in and out,
  assets and the amount, and gives a rate with the reasons, or declines with the reason.
- **Online** (Shop → Loans): the same personal and medical loans to weaker files, about 9 points dearer
  and for 40% of the amount. Business, vehicle and home loans are a branch's.
- **Medical bills**: a plan from the small-loans desk pays the hospital directly; the money never
  passes through the wallet.
- **Mortgages**: a home loans specialist's pre-approval holds its rate for 14 days and is used by
  `buy_home`; without one the online rate applies. Each mortgage keeps its own rate.
- **Repaying**: monthly (30 game days) as a bill, taken from the wallet when due (autopay). Three
  missed payments default the loan: the balance goes to collections, the file is marked for two years,
  and whatever comes into the account goes to the debt first.
- Commands: `loan_quote`, `take_loan`, `repay_loan`, `loan_autopay`, `preapprove_mortgage`. Every figure
  is the server's: a rate or payment sent by a client is not read.

## Business books (`docs/city/books.mjs`, `enterprise.mjs`, `finance-panels.mjs`)

- Each closed day is folded into its week with what sold by item. A business keeps 120 days, 60 weeks
  (item detail for 13) and its last 60 account movements.
- The Books tab shows: revenue and profit over the past month, three months and year; a balance sheet;
  average order, orders a day, share served; items by popularity with price, margin and a week-by-week
  history; a cost breakdown; recent transactions. Line and ring charts sit beside tables of the same
  figures. All spans are game days.
- **What is real and what is estimated.** Every figure is a sum of what the world recorded as it
  happened: the customers its hourly simulation brought and what players bought at the counter. Days
  before the records begin are filled from a typical week of the same model, drawn dashed, and every
  total says how many of its days are estimated.
- **Residents' shops** keep books from the day a player first deals with one (buys there, or asks its
  price). The 24 most recently dealt-with are kept. Whoever buys the shop inherits its books.
- The customers in the books are the server's simulation, not the walkers a browser draws: those are
  made by each browser for itself and can not be one record for everyone.

## Courts (`docs/city/sports.mjs`)

An hour on a court is either empty or a game of a size the sport has (tennis 1, 2 or 4; basketball 1
to 10; a half court 1 to 6), dealt from the court and the day. Residents join an hour that has a game.
On the court they play: a rally with swings and serves, a possession brought up, worked round the arc
and shot, or shooting around alone. Anyone over the game's number waits at the side.

## Spawn points (`src/smc/renderer/page/module/28-the-headset.js`, `docs/home-lobby.mjs`)

- Nobody starts in the road: a spawn point, a home's door or the default is moved to the nearest
  pavement once the streets are in.
- With no spawn point chosen, you start at the home you own.
- "My real location" sets the spawn from the device's position where the map covers it, and says why
  when it can not. "Where my walker stands now" says so when the world is not ready.
- City mode ignores a spawn point outside its area (that was the endless load: the walker's build and
  the area's build undid each other). A load that has stopped moving for 90 seconds is let through.

## The voices of the city (`docs/city/npc-talk.mjs`, `server/npc/`, `/api/npc`)

1. **Sorting.** A greeting, thanks, goodbye, yes or no, a one-word reply, and every opening line are
   answered from set lines in the character's tone. No model is called for these, on any path.
2. **A real question** goes to `/api/npc` with the city session token. The server sorts it again, then
   builds the prompt: one set of guidelines for every character, the character's cached sheet
   (backstory, tone, finances, job, routes: `buildNpcContext`), then only what that character may know
   of the player, read from the server's world: a banker gets the credit file, a lawyer the cases, a
   boss the work record, a doctor the health; someone in the street gets a name.
3. **Decisions are never the model's.** A banker is handed the bank's own answer to explain.
4. With no key, a limit reached (24 model calls a player in ten minutes) or the model failing, the
   character answers with a set line.

To switch it on, set in Vercel (Production) and redeploy:

| Variable | Value |
| --- | --- |
| `DEEPSEEK_API_KEY` | the key |
| `DEEPSEEK_MODEL` | optional; default `deepseek-flash` (DeepSeek V4.1 Flash) |
| `DEEPSEEK_BASE_URL` | optional; default `https://api.deepseek.com` |

The model id is the one DeepSeek's own model list gives (`GET /models`). It also needs the city
server set up (docs/45).

## Limits

- A new account can borrow a small amount, give it away and abandon the account, as it can its
  starter grant.
- The talk limit is per warm server instance, not global.
- A resident's sheet is sent by the page (residents are simulated in each browser); what the
  character knows of the player is never taken from the page.
