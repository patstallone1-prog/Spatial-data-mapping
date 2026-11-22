# 58 · Trials by jury

2026-11-22. `docs/city/trial.mjs`; the page's part is in `messages-panel.mjs`.

## The summons

| | before | now |
| --- | --- | --- |
| who is called | anyone, in the city or not | only someone who did something in the last 20 real minutes |
| when the case is | an appointment four game days on, at the court | open from the moment of the summons, for six real hours, from your messages |
| how often | every 30 game days at most (a day and a half of real time) | every 14 real days at most |

Not answered by its close, the case goes on without you and you are told so. Nothing more.

## The trial

"Go to the case" in the summons opens a conversation of its own:

1. **The judge** names the case, the charge (with its code section) and the burden of proof.
2. **The prosecutor** opens and puts in the People's exhibits.
3. **Witnesses** (an officer, a passer-by) say what they saw.
4. **The defence** (the accused's lawyer, the public defender, or the accused alone) answers
   with its own exhibits; **the accused** says their piece.
5. You may **ask** up to four questions; each is answered in the thread, with the exhibit it
   turns on.
6. You **vote**: not guilty, guilty, or guilty of the lesser offence.

Each **exhibit** is a link under the message. It opens on the page as a picture: a camera frame
(sharp, or dark and half hidden), a police report, a witness's statement, a card receipt, a
camera's service log, a record. What happened shows in them: a clear frame and a certain witness
when it did; a hidden plate, a witness forty metres off at dusk and a receipt from across the
city when it did not. Over 200 guilty and 200 innocent cases the evidence alone tells them apart
more than four times in five.

## The verdict and the sentence

- The verdict is the **majority** of the jurors who voted; a tie is not guilty; the lesser
  offence if most of those for guilt say so.
- **The judge affirms it and sentences**: acquitted; the lesser offence (half the fine);
  guilty, which is the fine on the record, or for a crime with one prior a month's probation,
  with two (or a battery with one) jail.
- With **no juror voting** by the close, the judge rules on the weight of the evidence as it was
  put (`benchRuling`): never by chance.

## A player's own case

When a case of yours comes to its hearing it is tried this way. Everyone in the city then (up to
five, never you) is summoned; as others arrive they are called too. Attending court marks you
present and opens the trial at once; absent, your side's evidence counts for half if the judge
rules alone. The sentence is the real one: the fine dismissed, halved or left standing, the
conviction on your record, probation, or jail as it already worked. The old weighted chance is
no longer used by anything.

One of the city's residents convicted goes on the court's docket and their fine is paid to the
city.

## Limits

- Residents on trial are made for the case: the person convicted is not one you can meet in the
  street, and their jail term is a line on the docket.
- A player's own case is always put as it was charged (the page saw them do it); how well it is
  proved depends on what saw it (a camera, an officer, a witness) and on their lawyer.
- The words are written, not generated: cases of one charge read alike after a few.
- `docs/city/trial-sheet.html` shows a sample case and its exhibits.
