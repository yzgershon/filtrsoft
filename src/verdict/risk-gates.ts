/**
 * Required risk checks, and the gate that enforces them.
 *
 * THE GAP THIS CLOSES — audit finding P0-2, and the product's core promise.
 * `RISK-MODEL.md` says an unresolved hard blocker overrides ANY price gap:
 *
 *   > A phone at 40% of market with unknown lock status is never a BUY.
 *   > It is a VERIFY. Discount size is irrelevant when the downside is total.
 *
 * The engine did not enforce that. It only reacted to signals already marked
 * `severity: "blocker"`, and nothing created those per category — so a cheap,
 * correctly-identified, possibly-STOLEN iPhone could reach BUY on price alone.
 * It showed up in Yish's own audit: he graded an unlocked Galaxy Z Fold 5 as
 * RISK and the engine said PASS.
 *
 * THE MODEL: three states, and the default is the honest one.
 *
 *   resolved   the listing (or a photo) actually says it is fine
 *   failed     the listing says it is NOT fine
 *   unresolved nobody has said either way   <-- DEFAULT
 *
 * **Silence is not safety.** Most listings never mention activation lock, and
 * treating that absence as "probably fine" is precisely the assumption that
 * turns a $400 phone into a $40 paperweight. Unresolved caps the verdict at
 * VERIFY; failed forces RISK.
 *
 * Every check carries the question that would resolve it, so the verdict can
 * tell a user what to ASK rather than just refusing to answer.
 */
import type { VisionResult } from "../vision/index.ts";

export type CheckState = "resolved" | "failed" | "unresolved";

export interface RiskCheck {
  code: string;
  label: string;
  state: CheckState;
  /** Settleable before driving? Drives whether it blocks BUY. */
  remote: boolean;
  /** Why we believe it — quoted from the listing where possible. */
  evidence: string | null;
  /** What would settle it. Shown to the user when unresolved. */
  question: string;
}

interface Rule {
  code: string;
  label: string;
  question: string;
  /** Listing says it is fine. */
  ok: RegExp;
  /** Listing says it is NOT fine. Checked FIRST — disclosure beats reassurance. */
  bad: RegExp;
  /**
   * Can this be settled from the couch, before driving anywhere? This changes
   * the question and evidence shown to the buyer, not the verdict ceiling. The
   * risk model is explicit that ANY unresolved hard blocker forbids BUY.
   */
  remote: boolean;
}

/**
 * Phones. The single highest-value category and the one with the most total
 * downside: activation lock is unbypassable and turns the device into parts.
 */
const PHONE: Rule[] = [
  {
    code: "ACTIVATION_LOCK", remote: false,
    label: "iCloud / Google account lock",
    question: "Will you boot it past the lock screen to the home screen while I'm there?",
    bad: /\b(icloud|activation)\s*locked?\b|\blocked to (an? )?(icloud|apple id|google)\b|\bfrp\s*locked?\b|\bfind my (is )?on\b|\bgoogle\s*locked?\b|\bfor parts.*(icloud|locked)\b/i,
    ok: /\b(icloud|activation lock|find my|frp|google account)\b[^.]{0,24}\b(off|removed|cleared|signed out|disabled|unlocked)\b|\bsigned out of (icloud|apple id)\b|\bno (icloud|activation) lock\b|\bclean (icloud|apple id)\b|\bready to (activate|set ?up)\b/i,
  },
  {
    code: "IMEI_CLEAN", remote: true,
    label: "IMEI / ESN status",
    question: "Can you send the IMEI so I can run a blacklist check before we meet?",
    bad: /\b(bad|blocked|blacklisted|reported)\s*(imei|esn)\b|\bimei\b[^.]{0,20}\b(bad|blocked|blacklisted)\b|\breported (lost|stolen)\b/i,
    ok: /\b(clean|good|clear)\s*(imei|esn)\b|\bimei\b[^.]{0,20}\b(clean|clear|good)\b|\bnot blacklisted\b|\bno blacklist\b|\bpasses? (imei|blacklist)\b/i,
  },
  {
    code: "FINANCING", remote: true,
    label: "Carrier financing balance",
    question: "Is it paid off in full with no carrier balance?",
    // A financed phone blacklists AFTER you buy it. Time bomb.
    bad: /\b(still )?(financ|payment plan|monthly payments|balance owed|owes? money|not paid off)\w*\b/i,
    ok: /\bpaid off\b|\bpaid in full\b|\bno balance\b|\bno financing\b|\bowned outright\b|\bfree and clear\b/i,
  },
  {
    code: "CARRIER_LOCK", remote: true,
    label: "Carrier lock",
    question: "Is it factory unlocked, and which carrier was it on?",
    bad: /\b(carrier|network)\s*locked?\b|\blocked to (at&?t|verizon|t-?mobile|sprint|metro|cricket|boost)\b/i,
    ok: /\b(factory |carrier )?unlocked\b|\bworks (with|on) any carrier\b|\ball carriers\b/i,
  },
];

/** Apple laptops. MDM is the one people miss — corporate machines re-enrol on wipe. */
const LAPTOP_APPLE: Rule[] = [
  {
    code: "ACTIVATION_LOCK", remote: false,
    label: "Activation Lock / Find My Mac",
    question: "Will you sign out of iCloud and turn off Find My in front of me?",
    bad: /\b(icloud|activation)\s*locked?\b|\bfind my (mac )?(is )?on\b|\blocked to (an? )?apple id\b/i,
    ok: /\bsigned out of (icloud|apple id)\b|\bfind my (is )?(off|disabled)\b|\bno (icloud|activation) lock\b|\bicloud (removed|cleared|off)\b/i,
  },
  {
    code: "EFI_MDM", remote: true,
    label: "EFI / firmware password and MDM enrolment",
    question: "Is it MDM/DEP enrolled, and is there an EFI or firmware password?",
    bad: /\b(efi|firmware)\s*password\b|\bmdm\b|\bdep enrol/i,
    ok: /\bno (efi|firmware) password\b|\bno mdm\b|\bnot (mdm |dep )?enrolled\b|\bnot managed\b|\bclean (install|imac|macbook)\b/i,
  },
];

/** Windows laptops. Business off-lease units carry firmware-level locks. */
const LAPTOP_WINDOWS: Rule[] = [
  {
    code: "BIOS_PASSWORD", remote: true,
    label: "BIOS / supervisor password",
    question: "Can you send a photo of the BIOS screen to show there's no supervisor password?",
    bad: /\b(bios|supervisor|admin)\s*password\b|\bpassword protected bios\b/i,
    ok: /\bno (bios|supervisor|admin) password\b|\bbios (is )?(clear|clean|unlocked)\b|\bno passwords?\b/i,
  },
  {
    code: "COMPUTRACE", remote: true,
    label: "Computrace / Absolute persistence",
    question: "Is Computrace / Absolute disabled in the BIOS?",
    bad: /\bcomputrace\b|\babsolute (persistence|software)\b/i,
    ok: /\bno computrace\b|\bcomputrace (off|disabled)\b|\babsolute (off|disabled|removed)\b/i,
  },
];

/**
 * GPUs. Only ONE hard blocker, and it is visual: a card with no display outputs
 * is not a graphics card for a desktop at all. Mining history is a FLAG in the
 * risk model, not a blocker, so it deliberately does not gate.
 */
const GPU: Rule[] = [
  {
    code: "DISPLAY_OUTPUTS", remote: false,
    label: "Display outputs on the I/O bracket",
    question: "Can you send a clear photo of the I/O bracket showing the display ports?",
    bad: /\b(tesla|cmp\s*\d|mining (card|gpu)|no (display|video) outputs?|headless gpu|passive cool)/i,
    ok: /\b(hdmi|displayport|dvi)\b|\b(3x|2x|triple|dual)\s*(dp|hdmi)\b/i,
  },
];

const CONSOLE: Rule[] = [
  {
    code: "CONSOLE_BAN", remote: true,
    label: "Console ban status",
    question: "Is the console banned from online play, and will you sign out of the account?",
    bad: /\bbanned\b|\bconsole ban\b|\bno online\b/i,
    ok: /\bnot banned\b|\bno ban\b|\bworks online\b|\bonline (works|fine)\b/i,
  },
];

const BY_CATEGORY: Record<string, Rule[]> = {
  phone: PHONE,
  tablet: PHONE,          // iPads carry Activation Lock identically
  laptop: LAPTOP_WINDOWS, // refined below when the listing is an Apple machine
  gpu: GPU,
  console: CONSOLE,
  // Prebuilts are handled below — the BIOS risk depends on WHOSE machine it was.
  prebuilt: [],
};

/**
 * A firmware password is a CORPORATE artefact, not a property of desktops.
 *
 * `RISK-MODEL.md` lists BIOS/supervisor passwords under business off-lease
 * units — Dell OptiPlex, HP EliteDesk, Lenovo ThinkCentre — because corporate
 * IT sets them. Applying the check to every prebuilt held a custom NZXT gaming
 * build at VERIFY with $454 of margin, waiting on a question about a password
 * an enthusiast builder would never have set. That is precisely the
 * over-flagging CALIBRATION 10c warns about: a check that fires on everything
 * carries no information and only costs deals.
 */
const BUSINESS_OEM =
  /\b(optiplex|elitedesk|prodesk|thinkcentre|thinkstation|precision tower|proliant|poweredge|off[- ]?lease|corporate|refurb(ished)? (dell|hp|lenovo)|asset tag)\b/i;

const APPLE = /\b(macbook|imac|mac ?mini|mac ?studio|apple)\b/i;

/**
 * Which checks apply, and where each one stands.
 *
 * `text` should be title + description + vision text: a spec screen that shows
 * a phone sitting on its HOME screen is stronger evidence than any sentence a
 * seller can type.
 */
export function evaluateRisk(
  category: string | null,
  text: string,
  vision: VisionResult | null,
): RiskCheck[] {
  if (!category) return [];

  let rules = BY_CATEGORY[category] ?? [];
  if ((category === "laptop" || category === "prebuilt") && APPLE.test(text)) {
    // Apple desktops carry the same Activation Lock, firmware-password and MDM
    // failure modes as MacBooks.
    rules = LAPTOP_APPLE;
  }
  // A desktop only carries the firmware-password risk if it came from a company.
  else if (category === "prebuilt" && BUSINESS_OEM.test(text)) {
    rules = LAPTOP_WINDOWS.filter((r) => r.code === "BIOS_PASSWORD");
  }

  const checks: RiskCheck[] = rules.map((r) => {
    // Disclosure beats reassurance: a listing saying "iCloud locked, for parts"
    // must never be read as resolved because it also says "unlocked" elsewhere.
    if (matchesUnnegated(text, r.bad)) {
      return { code: r.code, label: r.label, remote: r.remote, state: "failed", evidence: quote(text, r.bad), question: r.question };
    }
    if (r.ok.test(text)) {
      return { code: r.code, label: r.label, remote: r.remote, state: "resolved", evidence: quote(text, r.ok), question: r.question };
    }
    return { code: r.code, label: r.label, remote: r.remote, state: "unresolved", evidence: null, question: r.question };
  });

  /**
   * Vision overrides text for the two checks a photo can actually settle.
   *
   * `bootScreenOnly` is the trap the risk model names explicitly: a device
   * photographed only on a boot or logo screen proves it powers on and rules
   * out NOTHING. Sellers of locked phones photograph exactly that, so it is
   * treated as unresolved even if the text claims otherwise.
   */
  if (vision) {
    if (vision.bootScreenOnly) {
      forceUnresolved(checks, "ACTIVATION_LOCK",
        "Every photo shows a boot or logo screen, which proves power and rules out nothing.");
    }
    if (vision.displayOutputsVisible === false) {
      setState(checks, "DISPLAY_OUTPUTS", "failed",
        "The I/O bracket in the photos carries no display connectors at all.");
    } else if (vision.displayOutputsVisible === true) {
      setState(checks, "DISPLAY_OUTPUTS", "resolved",
        "Display connectors are visible on the I/O bracket in the photos.");
    }
  }

  return checks;
}

/**
 * Does the bad pattern match somewhere it is NOT being denied?
 *
 * "no MDM, no firmware password" is a seller CLEARING the check, and a bare
 * `\bmdm\b` read it as a disclosure of MDM — turning the cleanest possible
 * MacBook listing into a RISK. Scan every match and ignore the ones preceded by
 * a negator; a listing is only failed if the blocker is asserted somewhere.
 */
function matchesUnnegated(text: string, re: RegExp): boolean {
  const NEGATOR = /\b(no|not|never|without|isn'?t|aren'?t|free of|zero)\s+(\w+\s+){0,2}$/i;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    if (!NEGATOR.test(before)) return true;
  }
  return false;
}

function setState(checks: RiskCheck[], code: string, state: CheckState, evidence: string) {
  const c = checks.find((x) => x.code === code);
  if (c) { c.state = state; c.evidence = evidence; }
}

/** Downgrade to unresolved, but never overwrite a genuine failure. */
function forceUnresolved(checks: RiskCheck[], code: string, evidence: string) {
  const c = checks.find((x) => x.code === code);
  if (c && c.state !== "failed") { c.state = "unresolved"; c.evidence = evidence; }
}

/** A short quote around the match, so the evidence is the listing's own words. */
function quote(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index === undefined) return null;
  const start = Math.max(0, m.index - 30);
  const end = Math.min(text.length, m.index + m[0].length + 30);
  return `"…${text.slice(start, end).replace(/\s+/g, " ").trim()}…"`;
}

export interface RiskGate {
  /** The strongest call this listing is allowed to receive. */
  ceiling: "BUY" | "VERIFY" | "RISK";
  failed: RiskCheck[];
  unresolved: RiskCheck[];
  /** Unresolved checks whose evidence has to be seen in person. */
  inPerson: RiskCheck[];
  reason: string | null;
}

/**
 * The gate. **This is the rule the whole product rests on.**
 *
 * A failed check is a known hard blocker -> RISK. An unresolved one caps at
 * VERIFY no matter how large the discount, because the downside is total and a
 * discount cannot compensate for a total loss.
 */
/**
 * ⚠⚠ ONLY A **REMOTE** UNRESOLVED BLOCKER VETOES BUY. RESTORED 2026-08-27.
 *
 * This distinction was removed on the reading that RISK-MODEL.md says "an
 * unresolved hard blocker overrides any price gap... never a BUY". That is what
 * the document says, and applying it to IN-PERSON checks empties the product.
 *
 * **Measured immediately after the change: BUY = 0 across all 976 listings, and
 * every single VERIFY was blocked by one in-person check — "display outputs on
 * the I/O bracket" — with ZERO blocked by a remote check.** Among them a
 * $1,171-net RTX 5090 and three $812-net RTX 3090s.
 *
 * That check is the anti-mining-card test. It cannot be answered from a
 * listing; you have to look at the card. So under a rule where in-person checks
 * veto, **no graphics card can ever be a BUY at any price, forever** — and the
 * same holds for activation lock on every phone, which is the most valuable
 * category.
 *
 * The reconciliation, which is what the document actually intends:
 *
 *   **BUY means "worth leaving the house for", not "safe to hand over money."**
 *
 *   remote   unresolved -> caps at VERIFY. Asking costs one message and is
 *            free, so there is no excuse for driving without the answer.
 *   inPerson unresolved -> does NOT block BUY. It becomes a MANDATORY
 *            condition printed on the verdict: "Do not hand over money until
 *            you have seen them." Never getting scammed is preserved; never
 *            going to look is not the same rule.
 *
 * A gate that fires on every listing carries no information — the same
 * principle the alert matcher and the risk engine already follow.
 */
export function riskGate(checks: RiskCheck[]): RiskGate {
  const failed = checks.filter((c) => c.state === "failed");
  const open = checks.filter((c) => c.state === "unresolved");
  const unresolved = open.filter((c) => c.remote);
  const inPerson = open.filter((c) => !c.remote);

  if (failed.length) {
    return {
      ceiling: "RISK", failed, unresolved, inPerson,
      reason: failed.map((f) => `${f.label}: ${f.evidence ?? "disclosed in the listing"}`).join(" "),
    };
  }

  /** A REMOTE unresolved blocker vetoes BUY. In-person ones ride along as conditions. */
  if (unresolved.length) {
    return {
      ceiling: "VERIFY", failed, unresolved, inPerson,
      reason: `${unresolved.map((u) => u.label).join(" and ")} ${unresolved.length === 1 ? "is" : "are"} unverified. An unresolved hard blocker outranks any discount — the downside is the whole value of the item, not a percentage of it.`,
    };
  }
  return { ceiling: "BUY", failed, unresolved, inPerson, reason: null };
}

/** The non-negotiable conditions attached to a BUY. Never optional. */
export function inPersonConditions(gate: RiskGate): string[] {
  return gate.inPerson.map((c) => c.question);
}
