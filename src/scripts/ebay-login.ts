/**
 * bun run ebay:login
 *
 * eBay shows SOLD prices to signed-in accounts on its own website. Sign in once
 * in the Chrome window; the session lives in ~/.filtrsoft/ebay-profile.
 *
 * As with Facebook, there is no login automation and there must never be —
 * Filtrsoft does not see or store your password.
 */
import { runEbayWorker } from "../sources/ebay.ts";

for await (const ev of runEbayWorker("login", { headless: false, background: false })) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "done") {
    console.log(ev.stats.loggedIn
      ? "\n\x1b[32msigned in — sold listings are readable.\x1b[0m Run `bun run ebay:comps` next."
      : "\n\x1b[31mstill signed out.\x1b[0m Sold search redirects to the login page.");
  }
}
