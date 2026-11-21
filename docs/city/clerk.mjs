// The person behind the counter: what they say when you walk up, by the kind of place it is.
//
// Shops used to be bought from with a panel by the door and a button on the action bar. Now you
// walk up to whoever is serving (a host at a fine restaurant's stand, a cashier at a counter, a
// clerk at a shop's till) and they ask what you want, the way such a place asks: a host has your
// table and the menu, a fast-food cashier points you at the board, a shoe shop asks your size.
// Their line carries a link -- the menu, or the shop's wares -- that opens in the middle of the
// screen (docs/city/shop-window.mjs).
//
// Pure (tests/city_clerk.test.mjs).

import { hash32 } from "./people.mjs";

//: What a store kind is, for how its staff talk and what their link opens.
export const CLERK_KINDS = {
  fine_dining: { who: "host", link: "menu", menu: "fine" },
  table: { who: "server", link: "menu", menu: "fine" },
  counter: { who: "cashier", link: "menu", menu: "board" },
  cafe: { who: "barista", link: "menu", menu: "board" },
  bakery: { who: "baker", link: "menu", menu: "board" },
  ice_cream: { who: "server", link: "menu", menu: "board" },
  bar: { who: "bartender", link: "menu", menu: "fine" },
  grocery: { who: "cashier", link: "shop" },
  pharmacy: { who: "pharmacist", link: "shop" },
  shoes: { who: "sales assistant", link: "shop" },
  clothing: { who: "sales assistant", link: "shop" },
  hardware: { who: "clerk", link: "shop" },
  books: { who: "bookseller", link: "shop" },
  beauty: { who: "receptionist", link: "shop" },
  care: { who: "receptionist", link: "shop" },
  liquor: { who: "clerk", link: "shop" },
  electronics: { who: "sales assistant", link: "shop" },
  florist: { who: "florist", link: "shop" },
  fuel: { who: "attendant", link: "shop" },
  shop: { who: "clerk", link: "shop" },
};

const FOOD = new Set(["restaurant", "american", "diner", "mexican", "japanese", "chinese", "thai", "vietnamese", "indian", "korean", "italian", "mediterranean", "seafood", "pizza", "deli"]);
const KIND_OF = {
  cafe: "cafe", bakery: "bakery", ice_cream: "ice_cream", bar: "bar", grocery: "grocery", convenience: "grocery", liquor: "liquor", wine_shop: "liquor",
  smoke_shop: "liquor", pharmacy: "pharmacy", clinic: "care", dentist: "care", optician: "care", vet: "care", gym: "care", hardware: "hardware", auto_parts: "hardware",
  clothing: "clothing", shoes: "shoes", books: "books", florist: "florist", salon: "beauty", barber: "beauty", nail_salon: "beauty", spa: "beauty", beauty: "beauty",
  laundry: "shop", dry_cleaner: "shop", hotel: "care", fuel: "fuel", pet: "shop", pet_grooming: "beauty", electronics: "electronics", gifts: "shop", gallery: "shop",
  jewelry: "clothing", toys: "shop", bike: "hardware", home: "shop", print_ship: "shop", general: "shop",
};

//: The clerk kind of a store: a food shop by how it serves (restaurant-room.mjs style: "counter",
//: "casual", "dining"), the rest by its trade.
export function clerkKind(storeKind, serviceStyle = null) {
  if (FOOD.has(storeKind)) return serviceStyle === "dining" ? "fine_dining" : serviceStyle === "counter" || storeKind === "deli" || storeKind === "pizza" ? "counter" : "table";
  return KIND_OF[storeKind] || "shop";
}

const greetingFor = (hour) => (hour < 5 ? "Hi there" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

// What each says: a few ways each, the {link} where their link goes, {name} the place's name.
const LINES = {
  fine_dining: [
    "{greet}, welcome to {name}. Just the one tonight? Right this way -- here's {link}. Your server will be with you shortly.",
    "{greet}, and welcome to {name}. I have a lovely table by the window for you. {Link}; the chef's specials are marked.",
    "Welcome to {name}. Do you have a reservation? No matter, we can seat you now. May I bring you {link}?",
  ],
  table: [
    "Hi, welcome in! Sit anywhere you like and I'll bring you {link}. Can I start you with something to drink?",
    "{greet}! Table for one? Here's {link} -- I'll give you a minute and come back for your order.",
    "Hey there, welcome to {name}. Here's {link}. Anything you're in the mood for today?",
  ],
  counter: [
    "Hi, welcome to {name}! What can I get started for you? {Link} is up on the board.",
    "Next guest! What'll it be? Everything's on {link}.",
    "{greet}! For here or to go? Take a look at {link} and tell me when you're ready.",
  ],
  cafe: [
    "Hey! What can I get you? {Link} is on the board behind me.",
    "{greet}! What are we having today? {Link}'s up there -- the pastries are fresh this morning.",
    "Hi, what can I make for you? Have a look at {link}.",
  ],
  bakery: ["{greet}! Everything was baked this morning. What would you like? {Link}.", "Hi there! What can I box up for you? Here's {link}."],
  ice_cream: ["Hi! Want to try a flavour before you choose? Here's {link}.", "{greet}! Cone or cup? {Link}'s on the board."],
  bar: ["Hey, what are you drinking? Here's {link}.", "{greet}. Can I get you something? {Link}'s right here -- the taps are on the back."],
  grocery: ["{greet}! Let me know if you need help finding anything. Here's {link}.", "Hi there. Find everything you need? You can see {link} here, and I'll ring you up."],
  pharmacy: ["{greet}. Picking up, or is there something I can help you find? {Link}.", "Hi, how can I help you today? Here's {link} -- ask me about anything behind the counter."],
  shoes: ["Hi! Looking for anything in particular? Running, work, something dressy? We've just had new styles in -- {link}. I can check your size in the back.",
    "{greet}! What size are you? Have a look at {link} and I'll bring a pair out to try on."],
  clothing: ["Hi there! Shopping for anything special today? {Link} -- the fitting rooms are just at the back.", "{greet}! We've got new arrivals in this week. Take a look at {link}."],
  hardware: ["{greet}. What are you working on? If you know what you need, it's all in {link}; if not, tell me the job.", "Hi, can I help you find something? Here's {link}."],
  books: ["{greet}! Looking for something in particular, or just browsing? {Link}.", "Hi there. Our staff picks are by the door -- or have a look at {link}."],
  beauty: ["{greet}! Do you have an appointment? Here's {link} -- what can we do for you today?", "Hi, welcome in. Take a look at {link}."],
  care: ["{greet}. Are you checked in? Here's {link}.", "Hi, how can I help you today? Here's {link}."],
  liquor: ["Hey. Need any help? {Link}. I'll need to see ID for anything with alcohol.", "{greet}. What can I get you? Here's {link}."],
  electronics: ["{greet}! Anything I can help you set up today? Here's {link}.", "Hi! Looking for anything in particular? {Link} -- I can tell you about any of it."],
  florist: ["{greet}! Something for an occasion? Here's {link}.", "Hi there. What can I put together for you? {Link}."],
  fuel: ["Hi. Pump number? Anything from inside? Here's {link}.", "{greet}. Here's {link} -- coffee's fresh."],
  shop: ["{greet}! Let me know if you need anything. Here's {link}.", "Hi there, welcome in. Have a look at {link}."],
};
const LINK_TEXT = { menu: { fine: "the menu", board: "the menu" }, shop: "what we have" };

//: What the person serving says as you walk up: {who, kind, text (with the link's words marked
//: as [[...]]), link: {kind: "menu" | "shop", style: "fine" | "board" | null, label}}.
//: ``visit`` varies the words from one visit to the next.
export function clerkLine({ storeKind, serviceStyle = null, name = null, hour = 12, staffName = null, visit = 0, place = "" } = {}) {
  const kind = clerkKind(storeKind, serviceStyle), spec = CLERK_KINDS[kind];
  const options = LINES[kind] || LINES.shop;
  const line = options[hash32(String(place), visit, kind) % options.length];
  const label = spec.link === "menu" ? LINK_TEXT.menu[spec.menu] : LINK_TEXT.shop;
  // (A place known only by its trade -- "Restaurant" -- is welcomed into, not named.)
  const text = (name ? line.replace("{name}", name) : line.replace(/ to \{name\}/, " in").replace("{name}", "here")).replace("{greet}", greetingFor(hour))
    .replace("{Link}", `[[${label.charAt(0).toUpperCase()}${label.slice(1)}]]`).replace("{link}", `[[${label}]]`);
  return { who: spec.who, kind, staffName, text, link: { kind: spec.link, style: spec.menu || null, label } };
}

//: The clerk among the people drawn: someone at work at ``placeId`` indoors, the nearest to
//: (x, z) within ``reach`` metres (a host, a cashier, a clerk), or null.
export function clerkNear(people, placeId, x, z, reach = 2.6) {
  let best = null, bd = reach;
  for (const e of people || []) {
    const p = e.person;
    if (!p || !e.indoors || String(p.work) !== String(placeId)) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

//: The text of a clerk line as parts: plain strings and the link ({link: label}).
export function lineParts(text) {
  const out = [];
  let at = 0;
  for (const m of String(text).matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ link: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
