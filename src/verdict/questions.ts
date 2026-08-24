/**
 * "Ask the seller" — generated per listing.
 *
 * From the Phase 0 research: no competitor ships this. It is also the cheapest
 * high-value thing in the product — pure rules over what we already know, no
 * model call, no comps.
 *
 * Ordering is deliberate: questions that could make the item WORTHLESS come
 * first, then value-determining unknowns, then condition. A buyer reading top to
 * bottom stops at the first "no" that matters.
 */
import type { SignalReport, Category } from "../types.ts";
import type { Match } from "../catalog/match.ts";

/** The one test per category that separates a working item from a paperweight. */
const KILLER: Partial<Record<Category, string[]>> = {
  phone: [
    "Is it fully paid off with no carrier balance? (An unpaid balance gets the IMEI blacklisted later, even after I buy it.)",
    "Can you send a screenshot of Settings → General → About so I can see the IMEI and exact model?",
    "Is it carrier locked or unlocked, and which carrier was it on originally?",
    "Screenshot of Settings → Battery → Battery Health?",
    "Can I see it powered on at the home screen when we meet? (Not the lock screen.)",
  ],
  tablet: [
    "Is it signed out of iCloud / the Google account, and will you sign out in front of me?",
    "Is it the Wi-Fi or cellular model?",
    "Can I see it at the home screen when we meet?",
  ],
  laptop: [
    "Can you boot it to the desktop and send a photo of the About / System screen?",
    "Any BIOS or firmware password set on it?",
    "Is it enrolled in any company device management? (Off-lease machines sometimes re-lock after a wipe.)",
    "What's the battery health or cycle count?",
    "Can you open and close the lid — any play or cracking in the hinges?",
  ],
  gpu: [
    "Can you send a photo of the I/O bracket showing the display outputs?",
    "Was it ever used for mining or any 24/7 workload?",
    "Can you send a photo of it running with GPU-Z open?",
    "Do you still have the original box?",
    "How long have you owned it, and why are you selling?",
  ],
  prebuilt: [
    "Can you send a screenshot of Task Manager on the Performance tab? (Shows CPU, GPU and RAM in one image.)",
    "What's the exact GPU model and how much VRAM?",
    "What brand and wattage is the power supply?",
    "Will you boot it and run something while I'm there?",
    "Why are you selling it?",
  ],
  console: [
    "Is the console banned from online play, or is the account in good standing?",
    "Which exact revision is it, and how much storage?",
    "Any drift on the controllers?",
    "Does the disc drive read reliably?",
  ],
  component: [
    "Do you have the original box and accessories?",
    "How long was it in use, and in what system?",
    "Can I test it before paying?",
  ],
};

/** Questions triggered by a specific signal firing. */
const BY_SIGNAL: Record<string, string> = {
  BOOT_SCREEN_ONLY:
    "Can you send a photo of it at the home screen rather than the startup logo? The boot screen only shows it powers on.",
  SCREENSHOT_ARTIFACTS:
    "Could you send a few photos you've taken yourself of the actual item, ideally with today's date written on paper next to it?",
  ZERO_PHOTOS:
    "Could you send photos of the actual item, including the ports and any serial or model label?",
  LONG_ON_MARKET: "Is this still available?",
  IRREVERSIBLE_PAYMENT: "I'd like to pay cash in person — does that work?",
  IMPOSSIBLE_CONNECTOR:
    "Just to confirm, which exact model is it? The cable you mentioned doesn't match that generation.",
  IMPOSSIBLE_SPEC_CLAIM:
    "Can you double-check that spec? It doesn't look compatible with the rest of the hardware listed.",
  CONDITION_CONTRADICTION:
    "Can you send close-up photos of the damage you mentioned, so I can see how bad it is?",
  PORT_DAMAGE: "Can you send close-ups of the ports and hinges?",
  GEOGRAPHIC_CONTRADICTION: "Where are you located, and where would we meet?",
  NO_DISPLAY_OUTPUT:
    "This card has no video outputs — were you aware? It can't drive a monitor.",
};

export function buildQuestions(
  signals: SignalReport,
  match: Match,
  opts: { missingFields?: string[] } = {},
): string[] {
  const out: string[] = [];
  const push = (q: string) => { if (q && !out.includes(q)) out.push(q); };

  // 1. Signal-driven first — these are why we're suspicious.
  for (const s of signals.signals) {
    const q = BY_SIGNAL[s.code];
    if (q) push(q);
  }

  // 2. The specific unknowns that block a valuation.
  for (const f of opts.missingFields ?? signals.missingValueFields) {
    if (f === "storage") push("What's the exact storage size?");
    if (f === "gpu") push("What's the exact graphics card model and VRAM?");
    if (f === "cpu") push("What's the exact processor model?");
    if (f === "ram") push("How much RAM, and what speed?");
    if (f === "model") push("What's the exact model?");
  }

  // 3. Category standards.
  const cat = (match.category ?? signals.category) as Category;
  for (const q of KILLER[cat] ?? []) push(q);

  return out.slice(0, 7);
}
