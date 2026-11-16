// Talking to the people of the city: the sorting layer, and the words that never need a model.
//
// Every message a player sends to a resident, a banker, a lawyer or a boss is sorted first:
//
// * "set"  -- a greeting, thanks, a goodbye, a yes or no, an "ok", and anything the character
//   says first (an opening line). Answered here, at once, from set lines in the character's tone.
//   No model is called, on any path.
// * "ai"   -- a real question, or anything that needs the character's own story, money, job or
//   route, or the player's (a banker reading your file). Sent to the city's server (/api/npc),
//   which calls the model with the character's cached context. If the server has no model set up
//   or it fails, fallbackLine() answers instead, so a conversation never hangs.
//
// Pure: used by the page (to answer set lines without a request) and by the server (which sorts
// again itself and never trusts the page's sorting).

export const TALK_TEXT_MAX = 400, TALK_HISTORY_MAX = 8;
//: The parts a character can play in a conversation; each is shown different things about the
//: player (server/npc/share.mjs).
export const TALK_ROLES = ["resident", "banker", "lawyer", "boss", "interviewer", "driver", "shopkeeper", "doctor"];

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const words = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").split(" ").filter(Boolean);

const INTENTS = [
  ["greeting", /^(hi|hello|hey|hiya|yo|howdy|sup|good (morning|afternoon|evening|day)|morning|afternoon|evening|greetings|hola)( there| again| everyone| all)?$/],
  ["thanks", /^(thanks|thank you|thx|ty|cheers|much appreciated|appreciate it|thanks a lot|thank you so much|thanks so much|many thanks)( a lot| so much| very much| again)?$/],
  ["bye", /^(bye|goodbye|good bye|see you|see ya|later|cya|take care|have a good (one|day|night|evening)|good night|goodnight|farewell|bye bye)( later| soon| then| around)?$/],
  ["yes", /^(yes|yeah|yep|yup|sure|ok|okay|k|alright|all right|fine|sounds good|got it|will do|right|of course|absolutely|deal|agreed)( then| thanks| thank you)?$/],
  ["no", /^(no|nope|nah|no thanks|no thank you|not now|maybe later|never mind|nevermind|not really)$/],
  ["how_are_you", /^(how are you|how are you doing|how's it going|hows it going|how is it going|how do you do|you ok|you okay|what's up|whats up|how have you been)( today| doing)?$/],
  ["sorry", /^(sorry|my bad|apologies|excuse me|pardon|pardon me|oops)$/],
  ["laugh", /^(lol|haha|ha|hehe|lmao|nice|cool|great|wow|awesome|good)$/],
];

//: How a message is answered: {route: "set" | "ai", intent}. ``opening``: the character speaks
//: first (always set).
export function sortMessage(text, { opening = false } = {}) {
  if (opening) return { route: "set", intent: "opening" };
  const w = words(text);
  if (!w.length) return { route: "set", intent: "silence" };
  const line = w.join(" ");
  for (const [intent, re] of INTENTS) if (re.test(line)) return { route: "set", intent };
  // A few words with no question in them are small talk; anything longer, or asking, is the model's.
  const asks = /\?/.test(text) || /^(who|what|when|where|why|how|which|can|could|would|will|do|does|did|is|are|am|should|may|tell|explain|show|give|help)\b/.test(line);
  if (!asks && w.length <= 2) return { route: "set", intent: "small" };
  return { route: "ai", intent: "question" };
}

// ---- the set lines ------------------------------------------------------------------------------------

const SET = {
  opening: {
    reserved: ["Hello.", "Yes? Can I help you?", "Afternoon."], warm: ["Hi there! How's your day going?", "Oh, hello! Nice to see a friendly face.", "Hey, good to see you."],
    direct: ["Hi. What do you need?", "Hello. What can I do for you?", "Yes?"], expressive: ["Hey hey! What's going on?", "Oh hi! Perfect timing, I was just thinking about a coffee.", "Well, hello!"] },
  greeting: {
    reserved: ["Hello.", "Hi.", "Good to see you."], warm: ["Hi! Lovely to see you.", "Hello there, how are you?", "Hey! How's your day?"],
    direct: ["Hi.", "Hello. What's up?", "Hey."], expressive: ["Hey!! Good to see you!", "Hi hi! What's new?", "Hello hello!"] },
  thanks: {
    reserved: ["You're welcome.", "Not at all.", "Of course."], warm: ["Any time, really.", "You're so welcome!", "Happy to help."],
    direct: ["No problem.", "Sure.", "Anytime."], expressive: ["Of course! Any time!", "Aw, don't mention it!", "Happy to!"] },
  bye: {
    reserved: ["Goodbye.", "Take care.", "See you."], warm: ["Take care of yourself!", "See you soon, I hope.", "Bye now, have a good one."],
    direct: ["See you.", "Bye.", "Later."], expressive: ["See you around!", "Bye! Don't be a stranger!", "Catch you later!"] },
  yes: { reserved: ["All right.", "Good.", "Understood."], warm: ["Wonderful.", "Great, thank you.", "Perfect."], direct: ["Good.", "Right.", "Done."], expressive: ["Great!", "Perfect!", "Love it."] },
  no: { reserved: ["As you like.", "That's fine.", "Understood."], warm: ["No worries at all.", "That's quite all right.", "Of course, no pressure."], direct: ["Okay.", "Fine.", "Your call."], expressive: ["No problem!", "All good!", "Fair enough!"] },
  how_are_you: {
    reserved: ["I'm well, thank you.", "Fine, thanks. You?", "Can't complain."], warm: ["I'm doing well, thank you for asking! And you?", "Pretty good today. How about you?", "Oh, not bad at all."],
    direct: ["Fine. You?", "Busy. Good, though.", "All good."], expressive: ["Honestly? Great day so far!", "Oh, you know, living the dream!", "Good! Busy, but good!"] },
  sorry: { reserved: ["It's fine.", "No harm done.", "Don't worry."], warm: ["Oh, don't worry about it.", "That's all right, really.", "No harm done at all."], direct: ["It's fine.", "Forget it.", "No problem."], expressive: ["Oh, it's nothing!", "Don't even worry!", "All good, really!"] },
  laugh: { reserved: ["Mm.", "Indeed.", "Ha."], warm: ["Ha, yes.", "It is, isn't it?", "I thought so too."], direct: ["Yep.", "Right.", "Ha."], expressive: ["Ha! Right?", "I know!", "Haha, exactly!"] },
  small: { reserved: ["Mm.", "I see.", "Right."], warm: ["Oh, I see.", "Mm, go on.", "Right, of course."], direct: ["Okay.", "And?", "Go on."], expressive: ["Oh?", "Ooh, tell me more.", "Go on!"] },
  silence: { reserved: ["…"], warm: ["Take your time."], direct: ["Yes?"], expressive: ["Hm?"] },
};
//: An opening line in a part's own words, where the part has one (the tone's line otherwise).
const ROLE_OPENING = {
  banker: ["Welcome in. I'm {name}, {title}. What can I look at for you today?", "Good to see you. {name}, {title}. Have a seat: what are you thinking of borrowing?"],
  lawyer: ["{name}. Tell me what happened, from the start.", "Come in. I'm {name}. What do they say you did?"],
  shopkeeper: ["Welcome in. Let me know if you need anything.", "Hi there. Looking for anything in particular?"],
  doctor: ["Hello, I'm {name}. What brings you in today?"],
  driver: ["Where to?", "Hi. Hop in."],
  boss: ["There you are. Ready for your shift?"],
  interviewer: ["Thanks for coming in. I'm {name}. Shall we start?"],
};
const FALLBACK = {
  reserved: ["I'd rather not get into that just now.", "I'm not sure what to tell you.", "Let me think about that."],
  warm: ["That's a good question. I wish I had a better answer for you right now.", "Hm, I'd have to think about that one.", "Ask me again another time? My head's somewhere else today."],
  direct: ["Can't get into that now.", "Not sure. Ask me later.", "No idea, honestly."],
  expressive: ["Ooh, that's a big one! Let me get back to you.", "Ha, I'd need a coffee before I answer that.", "You know, I have no idea!"],
};

function seeded(list, seed) {
  let hsh = 2166136261;
  for (const c of String(seed)) { hsh ^= c.codePointAt(0); hsh = Math.imul(hsh, 16777619); }
  return list[(hsh >>> 0) % list.length];
}
const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
const family = (f) => (SET.greeting[f] ? f : "reserved");

//: The set line for an intent, in the character's tone: {id, name, title, tone family, role}.
//: ``turn`` varies the line through a conversation.
export function setLine(intent, who = {}, turn = 0) {
  const f = family(who.tone), seed = `${who.id || who.name || ""}|${intent}|${turn}`;
  if (intent === "opening" && ROLE_OPENING[who.role]) return fill(seeded(ROLE_OPENING[who.role], seed), who).replace(/\s+,/g, ",").replace(/, \./g, ".");
  return seeded((SET[intent] || SET.small)[f], seed);
}
//: What a character says when the model could not be asked.
export function fallbackLine(who = {}, turn = 0) { return seeded(FALLBACK[family(who.tone)], `${who.id || who.name || ""}|fallback|${turn}`); }

//: A message as the server will take it: trimmed and bounded.
export function talkText(text) { return clean(text).slice(0, TALK_TEXT_MAX); }
