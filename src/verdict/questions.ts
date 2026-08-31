/**
 * "Ask the seller" — TWO questions, chosen for THIS listing.
 *
 * From the Phase 0 research: no competitor ships this. It is also the cheapest
 * high-value thing in the product — pure rules over what we already know, no
 * model call, no comps.
 *
 * ── WHY TWO, AND WHY NOT THE OLD LIST ──────────────────────────────────────
 *
 * Yish, 2026-08-28: *"the ask the seller section has too many questions and
 * also they are too general. Limit it to 2 questions and make them genuinely
 * tailored to the listing itself so they're not all just the same dumb
 * question."*
 *
 * The old version emitted up to SEVEN and finished with five fixed
 * category-standard questions, so every graphics card on the site asked for a
 * photo of the I/O bracket and whether it had been mined. Identical text on
 * every listing is not advice, it is wallpaper — and a seller who receives a
 * seven-question interrogation from a stranger usually just stops replying,
 * which costs the deal the questions were meant to protect.
 *
 * ── HOW THE TWO ARE CHOSEN ─────────────────────────────────────────────────
 *
 * Strictly by how much the ANSWER moves, given what this listing already says.
 * A question whose answer is already in the text is worthless no matter how
 * important the topic is in general.
 *
 *   1. A signal fired      — something is off about THIS listing.
 *   2. A remote blocker    — could make it worthless, and one message settles
 *                            it. In-person checks are deliberately NOT here:
 *                            you cannot answer them by text, so asking wastes
 *                            one of the two slots.
 *   3. A missing field     — names the exact spec the seller omitted, so it
 *                            reads as though a human read the post.
 *   4. Category fallback   — ONE, and only if nothing above filled both slots.
 *
 * Every question is phrased to be sendable as-is, because it is going into a
 * message box.
 */
import type { SignalReport, Category } from "../types.ts";
import type { Match } from "../catalog/match.ts";
import type { RiskCheck } from "./risk-gates.ts";

/**
 * Signal-driven questions. These reference something the listing actually did,
 * which is what makes them read as specific.
 */
export const BY_SIGNAL: Record<string, string> = {
  ZERO_PHOTOS:
    "Could you send a few photos of the actual item, including the ports and any model or serial label?",
  SCREENSHOT_ARTIFACTS:
    "Could you send a couple of photos you've taken yourself, with today's date on a piece of paper next to it?",
  BOOT_SCREEN_ONLY:
    "Could you send a photo of it at the home screen rather than the startup logo?",
  IRREVERSIBLE_PAYMENT:
    "I'd like to pay cash in person when I collect it. Does that work for you?",
  SHIPS_ON_LOCAL_MARKET:
    "I'd rather collect in person than have it shipped. Where would we meet?",
  IMPOSSIBLE_CONNECTOR:
    "Which exact model is it? The cable you mentioned doesn't match that generation.",
  IMPOSSIBLE_SPEC_CLAIM:
    "Could you double-check that spec? It doesn't look compatible with the rest of the hardware listed.",
  CONDITION_CONTRADICTION:
    "Could you send close-ups of the damage you mentioned so I can see how bad it is?",
  PORT_DAMAGE: "Could you send close-ups of the ports?",
  GEOGRAPHIC_CONTRADICTION: "Where exactly are you, and where would we meet?",
  NO_DISPLAY_OUTPUT:
    "This card looks like it has no video outputs. Can it actually drive a monitor?",
  LONG_ON_MARKET: "Is this still available, and are you flexible on the price?",
};

/**
 * Missing-field questions. They NAME the field, so the seller can see you read
 * the listing and noticed what was not in it.
 */
export const BY_FIELD: Record<string, string> = {
  storage: "How much storage does it have exactly?",
  gpu: "Which exact graphics card is in it, and how much VRAM?",
  cpu: "Which exact processor is it? (The full model number, e.g. i7-10700.)",
  ram: "How much RAM does it have, and is it upgradeable?",
  model: "Which exact model is it? The listing doesn't say.",
};

/**
 * ONE fallback per category — the single highest-value question when the
 * listing gave us nothing to be specific about. Not a list: a list is how the
 * old version ended up printing five identical questions on every card.
 */
export const FALLBACK: Partial<Record<Category, string>> = {
  phone: "Is it fully paid off and unlocked, with a clean IMEI?",
  tablet: "Is it signed out of iCloud, and will you sign out in front of me?",
  laptop: "Can you boot it to the desktop and send a photo of the About screen?",
  gpu: "How long have you owned it, and was it ever used for mining?",
  prebuilt: "Could you send a screenshot of Task Manager on the Performance tab? It shows the CPU, GPU and RAM in one image.",
  console: "Is the console banned from online play, and will you sign out of your account?",
  component: "How long have you had it, and has it been working fine?",
};

export function buildQuestions(
  signals: SignalReport,
  match: Match,
  opts: { missingFields?: string[]; riskChecks?: RiskCheck[] } = {},
): string[] {
  const out: string[] = [];
  const push = (q?: string | null) => {
    if (q && !out.includes(q) && out.length < 2) out.push(q);
  };

  // 1. Something is off about THIS listing. Highest information, always first.
  for (const s of signals.signals) push(BY_SIGNAL[s.code]);

  /**
   * 2. Remote blockers only. An in-person check ("show me the I/O bracket")
   * cannot be settled over text, so spending one of two slots on it buys
   * nothing — that is exactly the question Yish called out as useless.
   */
  for (const c of opts.riskChecks ?? []) {
    if (c.state === "unresolved" && c.remote) push(c.question);
  }

  // 3. The exact spec this seller left out.
  for (const f of opts.missingFields ?? signals.missingValueFields) push(BY_FIELD[f]);

  // 4. Only if the listing was complete and clean enough to say nothing else.
  push(FALLBACK[(match.category ?? signals.category) as Category]);

  return out;
}
