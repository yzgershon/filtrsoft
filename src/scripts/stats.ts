import { stats, DB_PATH } from "../db/index.ts";
import { readArchive } from "../db/archive.ts";

const s = stats();
console.log(`assyze.db  ${DB_PATH}\n`);
console.log(`comps            ${s.comps}${s.comps ? `  (${s.comps_classified} classified)` : ""}`);
console.log(`oldest comp      ${s.oldest_comp ?? "—"}`);
console.log(`skus             ${s.skus}  (${s.aliases} aliases)`);
console.log(`listings         ${s.listings}`);
console.log(`verdicts         ${s.verdicts}`);
console.log(`judgments        ${s.judgments}`);
console.log(`outcomes         ${s.outcomes}`);

/**
 * ARCHIVE DRIFT — the failure mode that already cost weeks.
 *
 * Production reads `data/archive.json.gz`, not this database. Every comps pull
 * widens the gap between them silently, and the only symptom is production
 * quietly pricing off a staler archive than the one on this machine. It is the
 * same shape as the bug that had production serving 0 comps while local held
 * 6,247: nothing was wrong, nothing was reported, and nothing worked.
 */
const archive = readArchive();
if (!archive) {
  console.log(`
⚠  No committed archive. Production has NO comps until you run:
   bun run archive  &&  git commit data/archive.json.gz  &&  git push`);
} else {
  const behind = s.comps - archive.comps.length;
  const age = Math.round((Date.now() - Date.parse(archive.exportedAt)) / 86_400_000);
  if (behind > 0) {
    console.log(
      `
⚠  Committed archive is ${behind} comps behind (${archive.comps.length} shipped, exported ${age}d ago).
` +
      `   Production prices off the ARCHIVE, not this file. To sync:
` +
      `   bun run archive  &&  git commit data/archive.json.gz  &&  git push`,
    );
  } else {
    console.log(`
archive          ${archive.comps.length} comps shipped, exported ${age}d ago — production in sync`);
  }
}

if (s.comps === 0) {
  console.log(
    `\n⚠  The comps archive is empty. eBay exposes ~90 days of sold data,\n` +
      `   so every day this isn't running is history you can never recover.\n` +
      `   Blocked on eBay API keys in .env`,
  );
}
