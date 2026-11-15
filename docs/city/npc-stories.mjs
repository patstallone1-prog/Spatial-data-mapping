// Authored fictional context shared by a cohort, independent of the simulation's
// individual histories. Nothing here claims a particular home, asset, or past job.
const STORIES = {
  "food": [
    "They learned to make a meal stretch by helping prepare food for crowded family gatherings. Remembering how a familiar place could steady a difficult week, they still notice whether people feel welcome before they notice the decor.",
    "As a teenager they spent weekends helping with neighborhood potlucks and learned how quickly a small oversight can spoil a busy afternoon. That experience left them proud of dependable service and impatient with people who treat service workers as invisible."
  ],
  "retail": [
    "They grew up accompanying relatives on carefully planned shopping trips, comparing prices and remembering which shopkeepers kept their promises. An early disappointment over a broken purchase made them value straightforward advice over a polished sales pitch.",
    "A neighborhood shop was the place they waited after school, listening to customers trade news while errands got done. Those afternoons taught them to read a room and made a familiar face feel more valuable than a grand introduction."
  ],
  "care": [
    "They remember a patient neighbor helping their household through a difficult stretch when they were young. That example stayed with them, and they learned to offer practical help without assuming they knew another person's whole story.",
    "Growing up, they were often the person others asked to explain a confusing instruction or settle a small disagreement. They learned that being listened to matters, and still become protective when someone is rushed or talked down to."
  ],
  "office": [
    "They grew up in a household where plans were written on scraps of paper and often changed at the last minute. Learning to organize that confusion gave them a lasting respect for clear agreements and people who follow through.",
    "A school project once fell apart because everyone assumed somebody else had done the unglamorous work. Rebuilding it with a few classmates taught them to ask specific questions and quietly keep a backup plan."
  ],
  "public": [
    "They grew up seeing a neighborhood problem linger until residents worked together to get it noticed. The eventual improvement made them believe ordinary rules should serve people, while delays and indifference still test their patience.",
    "When they were young, a local volunteer remembered their name and made an unfamiliar public place feel welcoming. They carried that lesson forward and tend to judge institutions by how they treat the person who needs the most help."
  ],
  "trade": [
    "They learned from an older neighbor who repaired everyday things instead of throwing them away. A repair that failed the first time taught them to check their work and respect experience without pretending anybody knows everything.",
    "As a young person they helped untangle a household move where almost nothing went to plan. They discovered a satisfaction in making something work with the tools at hand and still dislike promises that ignore practical limits."
  ],
  "transport": [
    "They grew up planning family outings around missed connections and the last ride home. Learning how a small delay can upset a whole day made them attentive to timing and sympathetic to people who are stranded.",
    "Their earliest trips across the Bay were remembered as a sequence of landmarks and people waiting at stops. They learned to notice the small changes along a route and still appreciate a journey that runs quietly to plan."
  ],
  "other": [
    "They once helped organize a small neighborhood event that nearly collapsed when several plans changed at once. Getting through it taught them to ask for help early and to remember the people who stayed to clean up.",
    "They grew up hearing relatives disagree about the safest way to build a decent life. Rather than settling the argument, they learned to respect different choices and to keep their own plans flexible."
  ],
  "looking": [
    "A plan they once relied on changed before they were ready, and they had to rethink what a good next step looked like. Since then they have tried to separate other people's expectations from the kind of daily life they actually want.",
    "They remember watching someone close to them start over without much encouragement. That example helps them keep trying, though casual advice to simply work harder can still sting."
  ],
  "retired": [
    "They spent years measuring weeks by obligations and learned how easily small pleasures could be postponed. A promise to make more time for familiar people now matters more to them than an impressive schedule.",
    "Someone older once told them that a neighborhood is held together by the people who keep showing up. Only later did they understand the remark, and they now take a quiet interest in who feels included and who has been forgotten."
  ],
  "student": [
    "A teacher once gave them time to solve a problem after everyone else had moved on. Remembering that small vote of confidence, they are curious about new ideas but wary of being embarrassed for asking a basic question.",
    "They once joined a group activity expecting to be good at it and discovered how much they still had to learn. The experience made them more willing to practice, even when they act as though a setback does not bother them."
  ],
  "child": [
    "They once watched a small seed turn into a plant and became fascinated by changes that happen slowly. They like adults who explain what is happening rather than simply telling them to wait.",
    "A favorite toy went missing and was eventually found in an unexpected place. Since then they have enjoyed small searches and discoveries, and familiar routines help them feel brave about trying something new."
  ],
  "visitor": [
    "A remembered recommendation from someone they trust gave them a reason to look beyond their usual stops. They arrived with a few expectations and are now comparing the place in front of them with the picture they had in mind.",
    "A past outing went better after they abandoned an overfilled itinerary and followed a useful local tip. They now leave room for small discoveries, while still wanting to know how to get back when the day is done."
  ],
  "unknown": [
    "They remember a small kindness from a stranger during a day that had gone badly. It left them attentive to everyday encounters and reluctant to assume a first impression tells the whole story.",
    "A familiar place changed when they were younger, and they learned that routines do not last forever. They still find comfort in small habits while keeping a little room for an unexpected turn."
  ]
};

const TONES = {
  reserved: ["quiet and thoughtful", "measured and observant", "soft-spoken and concise", "calm and reflective"],
  warm: ["friendly and reassuring", "welcoming and patient", "kind and conversational", "gentle and encouraging"],
  direct: ["straightforward and practical", "clear and matter-of-fact", "brisk and candid", "focused and concise"],
  expressive: ["lively and animated", "enthusiastic and talkative", "playful and expressive", "energetic and curious"],
};
const HOBBIES = {
  child: ["drawing", "picture books", "building blocks", "singing", "playing with toys", "nature walks"],
  student: ["drawing", "reading", "music", "games", "photography", "walking", "crafts", "puzzles"],
  adult: ["reading", "music", "cooking", "walking", "photography", "gardening", "puzzles", "drawing", "films", "crafts"],
};

function hash(value) {
  let h = 2166136261;
  for (const c of String(value ?? "")) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// The caller supplies one stable seed per group; every member receives this exact text.
export function selectNpcStory(profile = {}, seed = "") {
  const occupation = Object.hasOwn(STORIES, profile.occupation) ? profile.occupation : "unknown";
  const options = STORIES[occupation];
  const index = hash(`${occupation}|${seed}`) % options.length;
  return { cohortId: `${occupation}:${String(seed)}`, backstory: options[index] };
}

export function npcTone(profile = {}, seed = "") {
  const family = Object.hasOwn(TONES, profile.toneFamily) ? profile.toneFamily : "reserved";
  return TONES[family][hash(`tone|${seed}`) % TONES[family].length];
}

// These are fictional, stable preferences; they do not assert real-world facts.
export function npcHobbies(profile = {}, seed = "") {
  const group = profile.occupation === "child" || (Number.isFinite(profile.age) && profile.age < 5)
    ? "child" : profile.occupation === "student" || (Number.isFinite(profile.age) && profile.age < 18) ? "student" : "adult";
  const options = HOBBIES[group];
  const first = hash(`hobby-1|${seed}`) % options.length;
  const second = (first + 1 + hash(`hobby-2|${seed}`) % (options.length - 1)) % options.length;
  return [options[first], options[second]];
}
