/**
 * bun run ebay:auth
 *
 * Does the eBay production keyset actually work? Run this after any change to
 * the developer account, before assuming the code is wrong.
 *
 * It exists because `invalid_client` is eBay's answer to SIX different
 * problems — wrong id, wrong secret, sandbox keys against the production host,
 * a keyset that has not propagated, an account that has not completed
 * production verification, and an app pending review. The error body never
 * says which. This checks the shapes locally first so a typo is ruled out
 * before the network is blamed.
 */
const HOST = "https://api.ebay.com";
const id = (process.env.EBAY_CLIENT_ID ?? "").trim();
const secret = (process.env.EBAY_CLIENT_SECRET ?? "").trim();
const dev = (process.env.EBAY_DEV_ID ?? "").trim();

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;

if (!id || !secret) {
  console.log(bad("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set in .env"));
  process.exit(1);
}

// ---- shape checks, so a paste error never presents as an account problem ---
const env = id.includes("-PRD-") ? "production" : id.includes("-SBX-") ? "sandbox" : "unknown";
console.log(`\x1b[1meBay keyset\x1b[0m`);
console.log(`  app id   ${id.slice(0, 20)}…  (${env})`);
console.log(`  secret   ${secret.split("-")[0]}-…  ${secret.length} chars`);
console.log(`  dev id   ${dev ? `${dev.slice(0, 8)}…` : "(unset)"}`);

if (env === "sandbox") {
  console.log(bad(`sandbox keys cannot authenticate against ${HOST}`));
  process.exit(1);
}
if (secret.startsWith("SBX-")) {
  console.log(bad("the secret is a SANDBOX cert against a production app id"));
  process.exit(1);
}

// ---- the actual call ------------------------------------------------------
const basic = Buffer.from(`${id}:${secret}`).toString("base64");
let res: Response;
try {
  res = await fetch(`${HOST}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
} catch (e) {
  console.log(bad(`could not reach ${HOST} — ${(e as Error).message}`));
  process.exit(1);
}

const body = await res.json().catch(() => ({}) as Record<string, unknown>);

if (res.ok && body.access_token) {
  console.log(ok(`token issued, valid ${body.expires_in}s`));
  const b = await fetch(
    `${HOST}/buy/browse/v1/item_summary/search?q=rtx%204090&limit=3`,
    { headers: { Authorization: `Bearer ${body.access_token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } },
  );
  const d = await b.json();
  if (b.ok) {
    console.log(ok(`Browse API works — ${d.total} active listings for "rtx 4090"`));
    for (const i of d.itemSummaries ?? []) {
      console.log(`     ${i.price?.value?.padStart(8)} ${i.condition ?? ""}  ${i.title.slice(0, 52)}`);
    }
  } else {
    console.log(bad(`Browse API refused: ${b.status} ${JSON.stringify(d.errors ?? d).slice(0, 200)}`));
  }
  process.exit(0);
}

console.log(bad(`${res.status} ${body.error ?? ""} — ${body.error_description ?? ""}`));

if (body.error === "invalid_client") {
  console.log(`
The id and secret are the right SHAPE, so this is almost certainly account
state rather than a typo. In the eBay developer portal, check in this order:

  1. Application Keys page — does the PRODUCTION keyset show as enabled, or is
     there a "pending" / "action required" banner on it?
  2. Account → your developer account status. eBay requires production
     verification (a linked, verified eBay user account and the accepted API
     License Agreement) before production keys authenticate. The keyset is
     displayed before that step is finished, which is why it looks ready.
  3. If the keyset was created in the last few minutes, wait and re-run —
     propagation is not instant.

Re-run this with:  bun run ebay:auth`);
}
process.exit(1);
