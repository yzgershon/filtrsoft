/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * **WHY THIS EXISTS: without it the production keyset stays DISABLED.** eBay
 * does not merely recommend this endpoint — a production app that has neither
 * a working endpoint nor a granted exemption cannot authenticate at all. The
 * keyset is issued, displayed in full on the portal, and then refuses every
 * token request with `invalid_client`, which reads exactly like bad
 * credentials. That cost a round of debugging on 2026-08-26 before the portal
 * banner was read.
 *
 * The requirement is a privacy one: when an eBay user closes their account,
 * eBay tells every registered application so it can delete that user's data.
 *
 * **We chose the endpoint over the exemption deliberately.** An exemption is a
 * review queue with no deadline attached; this is thirty lines against a server
 * that is already live on HTTPS at a stable domain. There was no reason to wait
 * on a human for something we can satisfy in one deploy.
 *
 * ── THE HANDSHAKE ──────────────────────────────────────────────────────────
 *
 * eBay validates the endpoint by GETting it with a `challenge_code`, and
 * expects back the SHA-256 of THREE values concatenated in this exact order:
 *
 *     challengeCode + verificationToken + endpointUrl
 *
 * Two things about that make it easy to get silently wrong:
 *
 *   · **The endpoint URL is part of the hash**, so it must be the byte-exact
 *     string registered in the portal. `https://filtrsoft.com/v1/ebay/deletion`
 *     and the same URL with a trailing slash produce different digests, and
 *     eBay's failure message does not distinguish "wrong token" from "wrong
 *     URL". `EBAY_DELETION_ENDPOINT` overrides the default so the registered
 *     value is always the one that gets hashed.
 *   · **It is a hex digest, not base64.** eBay's own docs show hex.
 *
 * The POST that follows carries the actual deletion notice. We acknowledge it
 * with a 200 and log it. **Filtrsoft stores no eBay USER data** — comps are sold
 * listing prices, keyed by SKU, with no buyer or seller identity attached — so
 * there is nothing to erase. The log line exists so that if that ever stops
 * being true, there is a record of which notices arrived and when.
 *
 * Returning anything other than 200 makes eBay retry and eventually mark the
 * endpoint down, which disables the keyset again. So the POST handler must not
 * be able to throw.
 */
import type { Context } from "hono";
import { createHash } from "node:crypto";

const DEFAULT_ENDPOINT = "https://filtrsoft.com/v1/ebay/deletion";

export const deletionEndpoint = () =>
  (process.env.EBAY_DELETION_ENDPOINT ?? DEFAULT_ENDPOINT).trim();

/** Whether the endpoint can answer a challenge at all. */
export const deletionConfigured = () =>
  Boolean((process.env.EBAY_VERIFICATION_TOKEN ?? "").trim());

/**
 * GET — eBay's validation challenge.
 *
 * Also the only way to test this by hand, which is why it is worth having the
 * 500 branch say WHICH variable is missing rather than failing opaquely.
 */
export function handleDeletionChallenge(c: Context) {
  const challengeCode = c.req.query("challenge_code");
  if (!challengeCode) {
    return c.json({ error: "challenge_code is required" }, 400);
  }

  const token = (process.env.EBAY_VERIFICATION_TOKEN ?? "").trim();
  if (!token) {
    console.error("ebay-deletion: EBAY_VERIFICATION_TOKEN is not set — cannot answer the challenge");
    return c.json({ error: "endpoint is not configured" }, 500);
  }

  const endpoint = deletionEndpoint();
  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(token)
    .update(endpoint)
    .digest("hex");

  console.log(`ebay-deletion: answered challenge against ${endpoint}`);
  return c.json({ challengeResponse });
}

/**
 * POST — a real account-closure notice.
 *
 * Wrapped so that a malformed body cannot produce a non-200. eBay treats
 * repeated failures as an endpoint outage and disables the keyset, so being
 * unable to parse a notice is strictly better than rejecting it.
 */
export async function handleDeletionNotice(c: Context) {
  try {
    const body = await c.req.json().catch(() => null) as {
      metadata?: { topic?: string };
      notification?: { data?: { username?: string; userId?: string } };
    } | null;

    const user = body?.notification?.data?.username ?? body?.notification?.data?.userId ?? "unknown";
    console.log(`ebay-deletion: notice received for ${user} (${body?.metadata?.topic ?? "no topic"})`);
    // Nothing to erase: no comp, listing or verdict row carries an eBay user
    // identity. If that changes, the deletion goes HERE.
  } catch (e) {
    console.error("ebay-deletion: failed to read a notice —", (e as Error).message);
  }
  return c.body(null, 200);
}
