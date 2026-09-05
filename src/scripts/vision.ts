/**
 * bun run vision [--limit 40] [--dry]
 *
 * Read the photos of listings whose text never states the spec that decides
 * their price. **This is the biggest single lever on "can't tell".**
 *
 * ── THE MEASUREMENT THAT PUT THIS HERE ─────────────────────────────────────
 *
 * Yish, 2026-09-04: *"the cant tells start around listing 200 out of 1000 ...
 * so a solution to this could be to just get more comps and get a ton of
 * them."* Comps were the obvious answer and they are about a tenth of it. Of
 * 1,193 unpriceable listings:
 *
 *     692   a spec is not STATED  (storage 326, gpu 162, cpu 133, ram 71)
 *     384   no model could be matched at all
 *     117   genuinely no sold comps inside 90 days
 *
 * **653 of those 692 have photos, and vision had read 37 of them.** A storage
 * size lives on an iPhone's Settings screen; a GPU lives on the sticker or the
 * box in the third photo. The number is usually right there.
 *
 * ── WHY IT RUNS HERE AND NOT ONLY IN THE CONTAINER ─────────────────────────
 *
 * The container has the same pass on a loop, and it is *slower than it looks*:
 * `visionPass` re-fetches each listing page to reach its photos, and Facebook,
 * OfferUp and Mercari cannot be fetched without a logged-in browser — which is
 * exactly why `visionCandidates` deprioritises them. **338 of the 692 are on
 * those three sources**, so from Railway they are permanently unreadable no
 * matter how much budget is free.
 *
 * This machine has the browser and the sessions. Run here, and the whole 692 is
 * reachable rather than the Craigslist half.
 *
 * ⚠ IT SPENDS REAL MONEY AND THE GUARD IS SHARED. `visionPass` checks the daily
 * budget before EVERY listing, against the same `vision_spend` ledger the
 * server uses, so a local run and the container's loop cannot together exceed
 * `FILTRSOFT_DAILY_BUDGET_USD`. At roughly half a cent a read, the entire
 * backlog is about $3.60.
 */
import { visionPass } from "../crawler/vision-pass.ts";
import { visionCandidates } from "../crawler/vision-pass.ts";
import { budgetLeftUsd, spentTodayUsd } from "../vision/budget.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const limit = Number(arg("limit")) || 40;

const pool = visionCandidates(limit);
console.log(
  `vision: ${pool.length} listing(s) queued · $${spentTodayUsd().toFixed(3)} spent today · ` +
  `$${budgetLeftUsd().toFixed(2)} left`,
);

if (has("dry")) {
  for (const c of pool) console.log(`  would read #${c.id} [${c.call}] ${String(c.title).slice(0, 56)}`);
  process.exit(0);
}
if (!pool.length) {
  console.log("nothing is waiting on a photo read");
  process.exit(0);
}

/**
 * `visionPass` reports every verdict CHANGE through this callback, which is the
 * only output worth watching: a listing moving INSUFFICIENT_DATA -> BUY is the
 * whole reason to spend the money.
 */
const read = await visionPass(limit, (m) => console.log(`  ${m}`));

console.log(
  `\nread ${read} of ${pool.length} · $${spentTodayUsd().toFixed(3)} spent today · ` +
  `$${budgetLeftUsd().toFixed(2)} left`,
);
if (read < pool.length) {
  console.log(
    "  Anything not read either hit the daily budget or could not be fetched;" +
    "\n  repeated fetch failures burn a 3-try budget and stop retrying forever.",
  );
}
if (read) console.log("Ship the new verdicts with `bun run push --source <source>`.");
