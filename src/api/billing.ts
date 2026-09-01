/**
 * Stripe billing.
 *
 * ── IT IS BUILT AND IT IS OFF, DELIBERATELY ────────────────────────────────
 *
 * The Phase 3 gate in MASTER-PLAN.md is "10 payers AND >=3% conversion of
 * active users". Assyze currently has no users, so switching this on would put
 * a paywall in front of an audience of one and cost the only thing that
 * matters right now, which is people using the feed at all. Yish was told this
 * and asked for it anyway, so it exists in full — but nothing gates until
 * `STRIPE_PRICE_ID` is set. `billingEnabled()` is false without it, every
 * endpoint 503s, and the UI shows the free plan.
 *
 * Flipping it on is one environment variable, not a deploy.
 *
 * ── WHY CHECKOUT SESSIONS AND NOT A CARD FORM ──────────────────────────────
 *
 * **No card details ever reach this server, and none ever will.** Stripe
 * Checkout is a hosted page: we create a session, redirect, and Stripe handles
 * the card. That keeps every PCI obligation on Stripe's side and means a
 * compromise of this box cannot leak a card number, because it never had one.
 * The same rule as everywhere else in this project — Assyze does not handle
 * credentials.
 *
 * ── THE WEBHOOK IS THE SOURCE OF TRUTH, NOT THE REDIRECT ───────────────────
 *
 * A user who pays and then closes the tab before the redirect has still paid.
 * A user who fakes the success URL has not. So entitlement is written ONLY by
 * the webhook, and `?paid=1` on the return URL is a hint to refresh, never a
 * grant. This is the single most common way a checkout integration ends up
 * giving away the product.
 */
import type { Context } from "hono";
import Stripe from "stripe";
import { db, now } from "../db/index.ts";

const KEY = () => (process.env.STRIPE_SECRET_KEY ?? "").trim();
const PRICE = () => (process.env.STRIPE_PRICE_ID ?? "").trim();
const WHSEC = () => (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
const SITE = () => (process.env.ASSYZE_SITE_URL ?? "https://assyze.com").replace(/\/$/, "");

/** Both a key AND a price. A key alone cannot sell anything. */
export const billingEnabled = () => Boolean(KEY() && PRICE());

let client: Stripe | null = null;
const stripe = () => (client ??= new Stripe(KEY(), { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion }));

export function ensureBillingTables() {
  /**
   * Keyed on a CLIENT-GENERATED account ref, not an email.
   *
   * There are no accounts in this product yet, and inventing an email login
   * purely to attach a subscription would be the largest change on this list
   * for the least benefit. The browser mints a random ref, stores it, and sends
   * it as `client_reference_id`; Stripe hands it back on the webhook. When real
   * accounts exist, this table gets a user_id column and nothing else changes.
   */
  db().run(`
    CREATE TABLE IF NOT EXISTS entitlements (
      ref            TEXT PRIMARY KEY,
      customer_id    TEXT,
      subscription_id TEXT,
      status         TEXT NOT NULL,
      current_period_end TEXT,
      updated_at     TEXT NOT NULL
    )`);
}

/**
 * ─────────────────────────────────────────────────────────── the owner tier
 *
 * Yish, 2026-09-01: *"you can turn on the stripe payment and add the plans
 * section (mine will always be the best one)."*
 *
 * `ASSYZE_OWNER_REF` is his device ref, set as an env var on the server. That
 * device reads as the top tier for good: no checkout, no subscription, no
 * expiry.
 *
 * ⚠ IT IS AN ENV VAR AND NOT A CLIENT-SIDE `if`, and the difference matters.
 * The ref travels in a query string, so a UI-only check would mean anyone who
 * read the JS could grant themselves the paid tier by typing his ref — and
 * every one of his API responses carries it. Deciding it server-side keeps the
 * entitlement a fact about the server's configuration rather than a claim the
 * client makes about itself.
 *
 * ⚠ IT IS ALSO NOT A ROW IN `entitlements`. A row would be silently
 * overwritten by any webhook that later mentions the same ref (a cancellation,
 * a failed payment on a card he tested with), and he would lose access to his
 * own product for a reason no screen could explain.
 */
const OWNER_REF = () => (process.env.ASSYZE_OWNER_REF ?? "").trim();
export const isOwner = (ref: string) => Boolean(ref) && ref === OWNER_REF();

/** `active` and `trialing` are the only states that grant access. */
export function entitlementFor(ref: string): { active: boolean; status: string; until: string | null } {
  if (isOwner(ref)) return { active: true, status: "owner", until: null };
  ensureBillingTables();
  const row = db().query("SELECT status, current_period_end FROM entitlements WHERE ref=?").get(ref) as
    { status: string; current_period_end: string | null } | null;
  if (!row) return { active: false, status: "none", until: null };
  return {
    active: row.status === "active" || row.status === "trialing",
    status: row.status,
    until: row.current_period_end,
  };
}

function upsert(ref: string, patch: {
  customerId?: string | null; subscriptionId?: string | null;
  status: string; periodEnd?: number | null;
}) {
  ensureBillingTables();
  db().run(
    `INSERT INTO entitlements (ref, customer_id, subscription_id, status, current_period_end, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(ref) DO UPDATE SET
       customer_id=COALESCE(excluded.customer_id, entitlements.customer_id),
       subscription_id=COALESCE(excluded.subscription_id, entitlements.subscription_id),
       status=excluded.status,
       current_period_end=COALESCE(excluded.current_period_end, entitlements.current_period_end),
       updated_at=excluded.updated_at`,
    [ref, patch.customerId ?? null, patch.subscriptionId ?? null, patch.status,
     patch.periodEnd ? new Date(patch.periodEnd * 1000).toISOString() : null, now()],
  );
}

// ------------------------------------------------------------------ routes

export function handleBillingStatus(c: Context) {
  const ref = (c.req.query("ref") ?? "").trim();
  const owner = isOwner(ref);
  /**
   * ⚠ THE OWNER IS ANSWERED BEFORE THE `billingEnabled()` GATE. His tier is a
   * property of the ref, not of whether a Stripe price happens to be
   * configured — otherwise unsetting `STRIPE_PRICE_ID` would silently demote
   * him to Free on his own app.
   */
  if (owner) {
    return c.json({
      enabled: billingEnabled(), plan: "owner", active: true,
      status: "owner", until: null, owner: true,
    });
  }
  if (!billingEnabled()) {
    return c.json({
      enabled: false, plan: "free", active: false, owner: false,
      reason: "no paid plan configured",
    });
  }
  const e = ref ? entitlementFor(ref) : { active: false, status: "none", until: null };
  return c.json({ enabled: true, plan: e.active ? "pro" : "free", owner: false, ...e });
}

export async function handleCheckout(c: Context) {
  if (!billingEnabled()) return c.json({ error: "billing is not configured" }, 503);
  const b = await c.req.json().catch(() => null) as { ref?: string } | null;
  const ref = (b?.ref ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return c.json({ error: "a valid ref is required" }, 400);

  try {
    const s = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: PRICE(), quantity: 1 }],
      client_reference_id: ref,
      allow_promotion_codes: true,
      // `?paid=1` only tells the app to REFRESH its status. It is not proof.
      success_url: `${SITE()}/?paid=1`,
      cancel_url: `${SITE()}/`,
    });
    return c.json({ url: s.url });
  } catch (e) {
    console.error("stripe checkout failed:", (e as Error).message);
    return c.json({ error: "could not start checkout" }, 502);
  }
}

/** The Stripe-hosted page where someone cancels or changes their card. */
export async function handlePortal(c: Context) {
  if (!billingEnabled()) return c.json({ error: "billing is not configured" }, 503);
  const b = await c.req.json().catch(() => null) as { ref?: string } | null;
  const row = db().query("SELECT customer_id FROM entitlements WHERE ref=?").get(b?.ref ?? "") as
    { customer_id: string | null } | null;
  if (!row?.customer_id) return c.json({ error: "no subscription on this device" }, 404);
  try {
    const s = await stripe().billingPortal.sessions.create({
      customer: row.customer_id,
      return_url: `${SITE()}/`,
    });
    return c.json({ url: s.url });
  } catch (e) {
    console.error("stripe portal failed:", (e as Error).message);
    return c.json({ error: "could not open the billing portal" }, 502);
  }
}

/**
 * The webhook. THE ONLY thing that grants or revokes access.
 *
 * **The signature check is not optional and the RAW body is required.** Stripe
 * signs the exact bytes it sent; parsing to JSON and re-serialising changes
 * key order and whitespace, the signature no longer matches, and the usual
 * "fix" is to skip verification — which turns this into an endpoint where
 * anyone who knows the URL can grant themselves a subscription by POSTing a
 * fake `checkout.session.completed`.
 */
export async function handleWebhook(c: Context) {
  if (!KEY() || !WHSEC()) return c.json({ error: "billing is not configured" }, 503);
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "missing signature" }, 400);

  let evt: Stripe.Event;
  try {
    const raw = await c.req.text();
    evt = await stripe().webhooks.constructEventAsync(raw, sig, WHSEC());
  } catch (e) {
    console.error("stripe webhook rejected:", (e as Error).message);
    return c.json({ error: "bad signature" }, 400);
  }

  try {
    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;
        if (s.client_reference_id) {
          upsert(s.client_reference_id, {
            customerId: typeof s.customer === "string" ? s.customer : null,
            subscriptionId: typeof s.subscription === "string" ? s.subscription : null,
            status: "active",
          });
          console.log(`billing: activated ${s.client_reference_id}`);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = evt.data.object as Stripe.Subscription;
        /**
         * The subscription payload carries no client_reference_id, so the row
         * is found by subscription id — which is why it is stored on the way
         * in. Without that, a cancellation cannot be matched to anyone and
         * access would never be revoked.
         */
        const row = db().query("SELECT ref FROM entitlements WHERE subscription_id=?").get(sub.id) as
          { ref: string } | null;
        if (row) {
          const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
          upsert(row.ref, {
            status: evt.type === "customer.subscription.deleted" ? "canceled" : sub.status,
            periodEnd: end,
          });
          console.log(`billing: ${row.ref} -> ${sub.status}`);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // A 500 makes Stripe retry, which is right for a transient fault but a
    // permanent loop for a bug. Logged and acknowledged.
    console.error("stripe webhook handler error:", (e as Error).message);
  }
  return c.json({ received: true });
}
