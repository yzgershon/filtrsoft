import { stats, DB_PATH } from "../db/index.ts";

const s = stats();
console.log(`assyze.db  ${DB_PATH}\n`);
console.log(`comps            ${s.comps}${s.comps ? `  (${s.comps_classified} classified)` : ""}`);
console.log(`oldest comp      ${s.oldest_comp ?? "—"}`);
console.log(`skus             ${s.skus}  (${s.aliases} aliases)`);
console.log(`listings         ${s.listings}`);
console.log(`verdicts         ${s.verdicts}`);
console.log(`judgments        ${s.judgments}`);
console.log(`outcomes         ${s.outcomes}`);

if (s.comps === 0) {
  console.log(
    `\n⚠  The comps archive is empty. eBay exposes ~90 days of sold data,\n` +
      `   so every day this isn't running is history you can never recover.\n` +
      `   Blocked on eBay API keys in .env`,
  );
}
