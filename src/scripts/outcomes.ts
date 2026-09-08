/**
 * bun run outcomes            record observed outcomes + show calibration
 * bun run outcomes --report   report only, record nothing
 *
 * Run after `bun run sweep` — the sweep finds what vanished, this turns the
 * confident ones into outcome rows and scores the engine against them.
 */
import { recordObservedOutcomes, calibration, realisedMargin } from "../tracker/outcomes.ts";
import { db } from "../db/index.ts";

if (!process.argv.includes("--report")) {
  const st = recordObservedOutcomes();
  console.log(`${st.considered} delisted considered · \x1b[32m${st.recorded} new outcomes\x1b[0m · ${st.skipped} skipped (not a qualifying disappearance, or already recorded)\n`);
}

const total = (db().query("SELECT COUNT(*) n FROM outcomes").get() as any).n;
console.log(`\x1b[1moutcomes: ${total}\x1b[0m\n`);

const cal = calibration();
if (!cal.length) {
  console.log("No reported transactions with frozen decision evidence to calibrate.");
  console.log("Disappearance records availability only. Report purchase/resale prices;");
  console.log("unknown sale prices and unknown costs stay unknown.");
} else {
  console.log("call                 n   median days   valuation error");
  console.log("------------------------------------------------------");
  for (const c of cal) {
    const err = c.medianErrorPct === null ? "     —"
      : `${c.medianErrorPct > 0 ? "+" : ""}${c.medianErrorPct}%`;
    console.log(
      `${c.call.padEnd(20)} ${String(c.n).padStart(2)}   ${String(c.medianDays ?? "—").padStart(11)}   ${err.padStart(15)}`,
    );
  }
  console.log("\nvaluation error = our predicted median vs reported transaction prices, using the decision recorded at the time.");
  console.log("Consistently positive means we are pricing HIGH, and every BUY is");
  console.log("overstated — the failure that loses money quietly.");
}

const real = realisedMargin();
if (real.length) {
  const net = real.reduce((s, r) => s + r.netCents, 0);
  console.log(`\n\x1b[1mrealised: ${real.length} flips · $${(net / 100).toFixed(0)} net\x1b[0m`);
} else {
  console.log("\nNo bought-and-resold outcomes yet. Those are the only source of");
  console.log("true realised margin, and what eventually replaces the guessed 0.85");
  console.log("Facebook gross ratio.");
}
