# 39 · Messages: the communication layer (2026-11-13)

Every conversation in the city goes through one layer, so later kinds of messages are new
threads rather than new systems.

## Where it lives

- **World:** `docs/city/messages.mjs`.
  - A thread has members (a list of players, or everyone) and messages.
  - A message may carry choices. Each member answers a choice once. A choice can only run world actions from a short allow-list:
    - `vote`, `pay_bill`, `contest`, `add_friend`;
    - interview answers, lawyer questions, jury replies, asking the cab to wait.
  - NPC and system text comes from `rules.json` `messages`, never from a client. A player can write only plain text (at most 500 characters) in player and NPC threads.
- **Hooks:** `installMessages()` wraps the world's methods that "speak", so the rest of the world does not know messages exist. It wraps:
  - `step`;
  - `cmd_hire_lawyer` and `decide`;
  - `cmd_propose` and `tally`;
  - `lawyerPrice` (rapport takes up to 15% off).
- **Screen:** `docs/city/messages-panel.mjs`.
  - A narrow **Messages** tab sits on the left edge, half-way down. That part of the edge is empty, so it covers no button, and it moves clear of the map's controls when they are open.
  - It shows the unread count.
  - It opens into a panel on top of everything, and closes with × or Esc. Typing in it never moves the walker.
  - A new message while the panel is shut shows as a notice.

## The three tabs

| Tab | Threads |
|---|---|
| **Players** | Direct messages. Groups of friends that you make, add to and leave. The **neighbours' group**: everyone whose home is in the same neighbourhood, joined and left automatically. The **Kerbside council**: everyone in the city. |
| **NPC** | **Lawyer:** taken on with odds, two updates chosen by how the evidence looks, the day before, the hour before, then the verdict. Each case together and each thank-you builds rapport, which brings a warmer hello and up to 15% off. **Interviewer:** 2–3 questions answered from choices, then a decision 15 minutes later. If hired, the same thread becomes **Boss** (shift reminders, a note after a late start, promotions), and **Former boss** after the job ends. **Cab driver:** on the way, at the kerb, and about to leave; asked once, the driver waits a minute more. |
| **System** | **Kerbside today:** a digest at the turn of each day (measures, hires, court decisions, fines, crashes and so on). **City Hall:** each measure, with Vote yes / Vote no in the message, and the result. **Notices:** fines and bills you can pay or contest from the message, late penalties, summonses, court decisions, and **jury duty**. |

## Jury duty

- A summons comes at most once a month, a few days ahead. It is for:
  - a party member's hearing when there is one;
  - otherwise, a resident's hearing.
- You can confirm it, or defer it once (by a week).
- You serve at the court in court hours, from a button in the message. You are paid the California juror fee of $15.
- Missing it is noted. For now, nothing more happens.

## Adding a new kind of message

1. Open a thread with `openThread(id, () => ({ tab, kind, name, tag, members }))`.
2. Add text with `post(thread, { from, name, tag, text, choices })`.
3. Put the words in `rules.json` `messages`.
4. If a choice needs to do something, add a `mail_<act>` method and put its name in `CHOICE_ACTS`.

## Known limits

- **Privacy in a party.** A party shares one world. The host sends the whole world to every member, so a direct message is private in the panel but not on the wire. This is the same as balances and records today. Real privacy needs the server-side world.
- **Lawyer timing.** Clock scale is 1, so a court date 2–14 days out means the lawyer's updates arrive over days.
