/**
 * bun run fb:login
 *
 * Opens a real Chrome window on your own profile. You sign in by hand.
 *
 * There is deliberately no automation of the login. Filtrsoft must never see, ask
 * for, or store a Facebook password or session token — Chrome holds the cookie
 * and we only drive Chrome.
 */
import { runWorker, PROFILE_DIR, CHROME_PATH } from "../sources/facebook.ts";

console.log(`chrome : ${CHROME_PATH}`);
console.log(`profile: ${PROFILE_DIR}\n`);

for await (const ev of runWorker("login", { headless: false, background: false })) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "done") {
    console.log(ev.stats.loggedIn
      ? "\n\x1b[32msigned in — session saved. You won't need to do this again.\x1b[0m"
      : "\n\x1b[31mstill not signed in.\x1b[0m Re-run and make sure Marketplace loads for you.");
  }
}
