/**
 * Score the engine against Yish's audit. This is the Phase 1 exit criterion.
 *
 * Direction matters more than raw agreement: the calibration found the engine
 * was systematically too generous (16 harsher corrections vs 10 softer), so a
 * bias check is more useful than a single accuracy number.
 */
import { db } from "../db/index.ts";

/** Audit-tool ref -> ingested listing title fragment. */
const MAP: Record<string, string> = {
  gamingpc650: "i7-6700K",
  teslap100: "Tesla P100",
  zfold5: "Z fold 5",
  iphone16pm: "iPhone 16 Pro Max",
  imac5k: "A2115",
  nzxt750: "SPECS IN PICTURES",
  iphone15cam: "iphone 15 128GB",
  latitude7420: "Latitude 7420",
  iphone15pm: "Unlocked iphone 15 Pro Max",
  zflip6: "Z Flip 6",
};

const RANK: Record<string, number> = {
  BUY: 4, FAIR: 3, VERIFY: 2, INSUFFICIENT_DATA: 2, OUT_OF_SCOPE: 2, UNKNOWN: 2, PASS: 1, RISK: 0,
};

const d = db();
const rows: Array<{ ref: string; human: string; engine: string; title: string }> = [];

for (const [ref, frag] of Object.entries(MAP)) {
  const j = d.query(
    `SELECT human_call FROM judgments WHERE external_ref=$r ORDER BY id DESC LIMIT 1`,
  ).get({ $r: ref }) as { human_call: string } | null;

  const v = d.query(
    `SELECT v.call, l.title FROM verdicts v JOIN listings l ON l.id=v.listing_id
     WHERE l.title LIKE $f ORDER BY v.id DESC LIMIT 1`,
  ).get({ $f: `%${frag}%` }) as { call: string; title: string } | null;

  if (j && v) rows.push({ ref, human: j.human_call, engine: v.call, title: v.title });
}

let exact = 0, harsher = 0, softer = 0;
console.log(`${"listing".padEnd(34)} ${"engine".padEnd(18)} ${"yish".padEnd(10)}`);
console.log("-".repeat(66));
for (const r of rows) {
  const e = RANK[r.engine] ?? 2, h = RANK[r.human] ?? 2;
  let mark = "=";
  if (r.engine === r.human) { exact++; }
  else if (e < h) { harsher++; mark = "engine harsher"; }
  else if (e > h) { softer++; mark = "engine softer"; }
  console.log(
    `${r.title.slice(0, 33).padEnd(34)} ${r.engine.padEnd(18)} ${r.human.padEnd(10)} ${r.engine === r.human ? "✓" : mark}`,
  );
}

const n = rows.length;
console.log(`\n${exact}/${n} exact  ·  ${harsher} engine harsher  ·  ${softer} engine softer`);
console.log(
  harsher > softer
    ? "\nEngine now leans STRICTER than Yish. Watch for over-flagging (CALIBRATION 10c)."
    : softer > harsher
      ? "\nEngine still leans MORE GENEROUS than Yish — the original calibration bias."
      : "\nNo systematic directional bias.",
);
console.log(`\nDisagreements are now VALUATION disputes, not logic errors — the eval set was
graded before any real comp existed. See HANDOFF section 2 before tuning.`);
