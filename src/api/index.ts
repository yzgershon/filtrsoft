/**
 * The HTTP API.
 *
 * THE BOUNDARY DECISION: everything the web app does goes through this versioned
 * API, and the mobile app will later use it unchanged. No logic lives in the view
 * layer. That is what makes Phase 4 a UI rewrite rather than a rebuild.
 *
 * Two shapes for the same work:
 *   POST /v1/checks         one JSON response. Text-only lands in ~200ms.
 *   GET  /v1/checks/stream  SSE, one event per stage. Use when vision is on,
 *                           so the page is useful long before photos are read.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { checkListing, checkStored, ENGINE_VERSION, type Stage } from "../engine/index.ts";
import { handlePush } from "./push.ts";
import { handleDeletionChallenge, handleDeletionNotice, deletionEndpoint, deletionConfigured } from "./ebay-deletion.ts";
import {
  handleVapid, handleSubscribe, handleListSearches, handleCreateSearch,
  handleDeleteSearch, handleTestPush, pushConfigured, ensureAlertTables,
} from "./alerts.ts";
import {
  handleBillingStatus, handleCheckout, handlePortal, handleWebhook, billingEnabled,
} from "./billing.ts";
import { getEconomics } from "../valuation/index.ts";
import { db, DB_PATH } from "../db/index.ts";
import { archiveStatus } from "../db/archive.ts";
import { VISION_MODEL, visionConfigured } from "../vision/index.ts";
import {
  rateLimit, clientKey, visionAllowed, visionKilled, budgetAvailable,
  singleFlight, guardStatus,
} from "./guard.ts";

const app = new Hono();

/**
 * CORS was `cors()` with no options — wildcard, any origin.
 *
 * The frontend is served from THIS origin in production, so it never needed
 * CORS at all; the wildcard only ever helped somebody else's page call this API
 * from their users' browsers. Dev origins are listed explicitly.
 */
const ALLOWED_ORIGINS = [
  "https://assyze.com", "https://www.assyze.com",
  "http://localhost:5177", "http://127.0.0.1:5177",
];
app.use("/*", cors({ origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null) }));

/**
 * Rate limit every check endpoint, not just the paid ones.
 *
 * Free checks are not free to everyone: each one fetches a Craigslist page, and
 * hammering them from one host gets that host blocked — which would take out the
 * crawler and the delisting tracker as collateral damage.
 */
app.use("/v1/checks/*", async (c, next) => {
  const { ok, retryAfter } = rateLimit(clientKey(c.req.raw.headers));
  if (!ok) return c.json({ error: "too many requests" }, 429, { "Retry-After": String(retryAfter) });
  await next();
});
app.use("/v1/checks", async (c, next) => {
  const { ok, retryAfter } = rateLimit(clientKey(c.req.raw.headers));
  if (!ok) return c.json({ error: "too many requests" }, 429, { "Retry-After": String(retryAfter) });
  await next();
});

/**
 * May THIS request spend money?
 *
 * Three independent gates, and the caller is told which one refused so a real
 * user is not left staring at a silently text-only result wondering why the
 * photos were ignored.
 */
function visionDecision(c: { req: { header: (k: string) => string | undefined } }, asked: boolean) {
  if (!asked) return { allowed: false, reason: "not requested" };
  if (!visionConfigured()) return { allowed: false, reason: "no API key configured" };
  if (visionKilled()) return { allowed: false, reason: "vision is switched off" };
  if (!visionAllowed(c.req.header("authorization"))) return { allowed: false, reason: "vision requires a token" };
  if (!budgetAvailable()) return { allowed: false, reason: "daily vision budget reached" };
  return { allowed: true, reason: "ok" };
}

const SUPPORTED = /^https?:\/\/(www\.)?(craigslist\.org|[a-z]+\.craigslist\.org)\//i;

function badUrl(url: string | undefined): string | null {
  if (!url) return "url is required";
  let u: URL;
  try { u = new URL(url); } catch { return "not a valid URL"; }
  if (!/^https?:$/.test(u.protocol)) return "only http and https are supported";
  if (!SUPPORTED.test(url)) {
    return "Only Craigslist listings are supported right now. Facebook Marketplace, OfferUp and Mercari are coming.";
  }
  return null;
}

/**
 * Health. Deliberately does NOT require the database.
 *
 * This endpoint's only job is to tell the platform the process is alive and
 * listening. Making it query SQLite meant a database problem presented as a
 * silent 91-second healthcheck timeout instead of an error anyone could read.
 * Database trouble is reported IN the payload, never by failing the check.
 */
/**
 * `ok` means THE ENGINE CAN DO ITS JOB, not merely that the process is alive.
 *
 * It used to be the literal `true`, and that is how production ran for weeks
 * reporting `{"ok":true, "comps":0}` — live, healthy, serving the frontend, and
 * returning INSUFFICIENT_DATA for every single listing because it had no sold
 * prices to compare against. A liveness probe that cannot distinguish "working"
 * from "structurally unable to answer" is not a health check, it is a ping.
 *
 * Still HTTP 200: the container IS up and should not be restart-looped over
 * this. `canPrice` is the field to alert on.
 */
app.get("/v1/health", (c) => {
  let stats: Record<string, unknown> = { db: "unavailable" };
  let canPrice = false;
  try {
    const comps = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
    const skus = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
    canPrice = comps > 0 && skus > 0;
    stats = {
      db: "ok", comps, skus,
      ...(canPrice ? {} : {
        warning: "no sold comps — every verdict will be INSUFFICIENT_DATA. " +
          "Run `bun run archive`, commit data/archive.json.gz, redeploy.",
      }),
    };
  } catch (e) {
    stats = { db: "error", dbPath: DB_PATH, error: (e as Error).message };
  }
  return c.json({
    ok: canPrice,
    canPrice,
    engine: ENGINE_VERSION,
    ...stats,
    vision: { configured: visionConfigured(), model: VISION_MODEL, ...guardStatus() },
    /**
     * Reports WHETHER the eBay verification token is set, never its value.
     * Without this the only way to know production has it is to make eBay
     * fail the challenge, which disables the keyset again.
     */
    ebay: { deletionEndpoint: deletionEndpoint(), deletionConfigured: deletionConfigured() },
    push: { configured: pushConfigured() },
    /**
     * What the SHIPPED archive holds, vs what the database holds. If
     * `archive.comps` exceeds `comps`, the file arrived and the import did not
     * run — which is invisible any other way.
     */
    archive: archiveStatus(),
    billing: { enabled: billingEnabled() },
  });
});

/** One-shot check. Text-only by default, which is the fast path. */
app.post("/v1/checks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const err = badUrl(body.url);
  if (err) return c.json({ error: err }, 400);

  const vd = visionDecision(c, Boolean(body.vision));

  try {
    // Coalesce concurrent identical work. Twenty people opening the same shared
    // link at once become ONE source fetch and ONE vision call.
    const r = await singleFlight(`${body.url}|${vd.allowed}`, () => checkListing(body.url, {
      vision: vd.allowed,
      persist: true,
      driveMinutes: body.driveMinutes,
      econ: body.economics ?? getEconomics(),
    }));
    return c.json({
      checkId: r.listingId,
      elapsedMs: r.elapsedMs,
      listing: {
        title: r.listing.title, url: r.listing.url,
        askingPriceCents: r.listing.askingPriceCents,
        location: r.listing.location, postedAt: r.listing.postedAt,
        photoUrls: r.listing.photoUrls, source: r.listing.source,
      },
      verdict: r.verdict,
      signals: r.signals.signals,
      meta: {
        category: r.signals.category,
        listingQuality: r.signals.listingQuality,
        sellerSophistication: r.signals.sellerSophistication,
        daysOnMarket: r.signals.daysOnMarket,
        match: r.match,
      },
      vision: r.vision,
      visionStatus: vd.reason,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Streaming check. One SSE event per stage. */
app.get("/v1/checks/stream", (c) => {
  const url = c.req.query("url");
  const err = badUrl(url);
  /**
   * Vision is the product, but it is also the only thing here that spends money,
   * and this endpoint is a public GET. It stays default-on for AUTHORISED
   * callers and is refused for everyone else — an anonymous visitor still gets a
   * real text-layer verdict, they just cannot bill Yish for it.
   */
  const vd = visionDecision(c, c.req.query("vision") !== "0");
  const vision = vd.allowed;
  const drive = Number(c.req.query("drive")) || undefined;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      if (err) { send("error", { error: err }); ctrl.close(); return; }
      send("meta", { vision: vd.allowed, visionStatus: vd.reason });

      try {
        await checkListing(url!, {
          vision, persist: true, driveMinutes: drive,
          onStage: (s: Stage) => send(s.stage, { elapsedMs: s.elapsedMs, ...(s.data as object) }),
        });
      } catch (e) {
        send("error", { error: (e as Error).message });
      }
      ctrl.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Nginx and friends buffer SSE into uselessness without this.
      "X-Accel-Buffering": "no",
    },
  });
});


/**
 * The feed — the actual product.
 *
 * Reads STORED verdicts, so it serves instantly no matter how slow analysis was.
 * Ranking is the thing no competitor can do: they filter by keyword and price
 * because they have no verdict to sort by.
 */
/**
 * Locally-crawled listings arriving from Yish's machine.
 *
 * Facebook (and any other source needing a signed-in browser) cannot run in
 * the container, so it runs on his laptop and pushes the FACTS here. The server
 * re-scores everything it receives with its own engine — see `push.ts`.
 */
app.post("/v1/push", handlePush);

/**
 * eBay requires these two before it will ENABLE a production keyset. See
 * `ebay-deletion.ts` — until they answer, every token request returns
 * `invalid_client` and looks like bad credentials.
 */
app.get("/v1/ebay/deletion", handleDeletionChallenge);
app.post("/v1/ebay/deletion", handleDeletionNotice);

/**
 * Saved searches and push. See `alerts.ts` — a push subscription IS the
 * identity here, so none of this needs an account.
 */
app.get("/v1/push/vapid", handleVapid);
app.post("/v1/push/subscribe", handleSubscribe);
app.post("/v1/push/test", handleTestPush);
app.get("/v1/searches", handleListSearches);
app.post("/v1/searches", handleCreateSearch);
app.delete("/v1/searches/:id", handleDeleteSearch);

/**
 * Billing. Built, and OFF until `STRIPE_PRICE_ID` is set — see `billing.ts`
 * for why putting a paywall in front of zero users is the wrong move.
 *
 * The webhook is NOT under the CORS or rate-limit middleware by accident: it
 * is a server-to-server callback from Stripe, and rate-limiting it by client
 * IP would drop legitimate retries during exactly the burst that matters.
 */
app.get("/v1/billing/status", handleBillingStatus);
app.post("/v1/billing/checkout", handleCheckout);
app.post("/v1/billing/portal", handlePortal);
app.post("/v1/billing/webhook", handleWebhook);

/**
 * One-tap outcomes — Codex's highest-leverage small feature, and the one that
 * finally closes the loop.
 *
 * `outcomes` has THREE rows. It is the table that records what listings
 * actually did, and without it every calibration argument between Yish and the
 * engine is settled by opinion rather than evidence — which has already
 * happened four times. The reason it is empty is that nothing in the product
 * ever asked.
 *
 * Deliberately no free-text form. "Bought", "Passed", "Seller stopped
 * replying", "Listing gone" are one tap each, because an outcome you have to
 * write a paragraph about is an outcome nobody records.
 */
app.post("/v1/checks/:id/outcome", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as {
    action?: string; pricePaidCents?: number; notes?: string;
  };
  const ACTIONS = ["bought", "passed", "no_reply", "dead_listing", "was_scam"];
  if (!body.action || !ACTIONS.includes(body.action)) {
    return c.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, 400);
  }

  const listing = db().query("SELECT id FROM listings WHERE id=$id").get({ $id: id });
  if (!listing) return c.json({ error: "not found" }, 404);

  // The SKU is resolved at RECORD time, not read time: the catalog changes, and
  // an outcome should remember which product it was about when it happened.
  let skuId: number | null = null;
  try { skuId = checkStored(id, {}).match.skuId ?? null; } catch { /* fine */ }

  db().query(
    `INSERT INTO outcomes (listing_id, sku_id, action, purchase_price_cents, notes, created_at)
     VALUES ($lid,$sku,$act,$price,$notes,$now)`,
  ).run({
    $lid: id, $sku: skuId, $act: body.action,
    $price: body.pricePaidCents ?? null,
    $notes: (body.notes ?? "").slice(0, 500) || null,
    $now: new Date().toISOString(),
  });

  const n = (db().query("SELECT COUNT(*) n FROM outcomes").get() as { n: number }).n;
  return c.json({ ok: true, action: body.action, totalOutcomes: n });
});

/**
 * The tracker fields, derived once and shared by the ranker and the response.
 *
 * These come from `sweep`, which re-checks every live listing daily. They are
 * the difference between a feed that lists things and a feed that knows what
 * happened to them.
 *
 * **A drop is measured from the FIRST observed price, not the last.** A seller
 * who walks $1,800 down to $1,500 in three steps has made one $300 concession,
 * and reporting it as three $100 moves both understates the signal and makes it
 * disappear the moment they stop moving.
 *
 * `asking_price_cents` is the price at CAPTURE and `last_price_cents` is the
 * price at the most recent sweep, so the current price is the latter when we
 * have one. Using the capture price as "current" would show a stale number
 * beside a correct drop and read as a bug.
 */
export function tracker(r: {
  delisted_at: string | null; delist_reason: string | null;
  asking_price_cents: number | null; last_price_cents: number | null;
  first_price_cents: number | null; latest_price_cents: number | null;
  last_seen: string | null;
}) {
  const pos = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);
  const current = pos(r.latest_price_cents) ?? pos(r.last_price_cents) ?? pos(r.asking_price_cents);
  const origin = pos(r.first_price_cents) ?? pos(r.asking_price_cents);
  const raw = origin !== null && current !== null && origin > current ? origin - current : 0;
  /**
   * A drop has to be worth saying. Below $5 or 3% it is a seller rounding
   * their own number, and badging that as a price cut trains people to ignore
   * the badge — which costs us the times it means something.
   */
  const drop = raw >= 500 && origin !== null && raw / origin >= 0.03 ? raw : 0;
  return {
    gone: Boolean(r.delisted_at),
    goneReason: r.delist_reason,
    goneAt: r.delisted_at,
    currentPriceCents: current,
    /** Only set when it actually moved down, so the UI can test one field. */
    priceDropCents: drop || null,
    priceWasCents: drop ? origin : null,
    lastSeen: r.last_seen,
  };
}

app.get("/v1/feed", (c) => {
  const call = c.req.query("call");           // optional filter
  const cat = c.req.query("category");
  /**
   * The feed was showing 40 of 600+ and the UI has no pager, so the rest was
   * simply unreachable — Yish counted the listings on screen against the total
   * I quoted him and they did not match, because they genuinely did not.
   *
   * `offset` makes the tail reachable at all; the default page grows to 60 and
   * the cap to 200, which is what the ranking pass already reads from the
   * database anyway. Ranking happens across `RANK_POOL`, not across the page,
   * so page 2 is still globally ranked rather than a second-best bucket.
   */
  const limit = Math.min(Number(c.req.query("limit")) || 60, 200);
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const showGone = c.req.query("gone") === "1";

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
           l.delisted_at, l.delist_reason, l.last_price_cents, l.last_seen,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb,
           /**
            * FIRST and LATEST observed price, both filtered to POSITIVE values.
            *
            * The drop is measured from where the listing STARTED, not from the
            * previous sweep: a seller who walks $1,800 down in three steps has
            * made one $300 concession, and reporting three $100 moves both
            * understates it and makes it vanish the moment they stop cutting.
            *
            * The price_cents > 0 guard is load-bearing, not defensive. A card
            * whose price fails to parse yields 0, and a zero read as a price
            * turns a $145 laptop into a $145 discount — it would have been the
            * top-ranked "deal" on the site.
            */
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at ASC LIMIT 1) first_price_cents,
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at DESC LIMIT 1) latest_price_cents
    FROM listings l
    JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
    WHERE v.call NOT IN ('OUT_OF_SCOPE')
      /**
       * NOTHING OLDER THAN 28 DAYS. Yish's rule, 2026-08-26: past a month a
       * listing is either sold or was never a deal, and either way showing it
       * spends the reader's attention on a dead end.
       *
       * Undated listings are KEPT. Facebook and the marketplaces do not always
       * expose a post date, and dropping everything without one would silently
       * delete whole SOURCES rather than stale rows.
       *
       * Measured when it shipped: 275 -> 200 locally, and on the production
       * page five of the eight it removed were FAIR calls on listings 46 to
       * 137 days old.
       */
      AND (l.posted_at IS NULL OR l.posted_at >= date('now', '-28 days'))
    ORDER BY l.posted_at DESC
    LIMIT 1200
  `).all() as any[];

  // Rank in JS — the score needs fields that live inside the verdict JSON.
  const RANK: Record<string, number> = { BUY: 0, VERIFY: 1, FAIR: 2, INSUFFICIENT_DATA: 3, RISK: 4, PASS: 5 };
  const ranked = rows.map((r) => {
    const v = r.payload ? JSON.parse(r.payload) : null;
    const net = v?.netProfitCents ?? 0;
    const ageDays = r.posted_at ? (Date.now() - Date.parse(r.posted_at)) / 86_400_000 : 99;
    // Deals decay: a great listing from 3 weeks ago is usually already gone.
    const freshness = Math.max(0, 1 - ageDays / 21);
    const t = tracker(r);
    /**
     * A price DROP is the strongest buy signal on any marketplace and it was
     * sitting unused in the database — `listing_prices` has been recorded on
     * every sweep since the tracker shipped and nothing ever read it.
     *
     * Bounded at +150 so it can reorder within a call band without ever
     * outranking the call itself: a PASS that got cheaper is still a PASS.
     */
    const dropBoost = t.priceDropCents ? Math.min(t.priceDropCents / 200, 150) : 0;
    /**
     * A DELISTED listing sinks below everything live. Not removed — see the
     * `gone` filter — because "this sold in 4 days at $650" is exactly the
     * evidence the outcome loop needs, and hiding it entirely would also hide
     * the proof that the tracker is working.
     */
    const goneP = t.gone ? -100_000 : 0;
    const score = (10 - (RANK[r.call] ?? 9)) * 1000 + Math.min(net / 100, 500)
      + freshness * 200 + dropBoost + goneP;
    return {
      id: r.id, title: r.title, url: r.url, source: r.source,
      askingPriceCents: r.asking_price_cents, location: r.location, postedAt: r.posted_at,
      thumb: r.thumb, call: r.call, confidence: r.confidence,
      headline: v?.headline ?? null,
      netProfitCents: v?.netProfitCents ?? null,
      flagCount: (v?.blockers?.length ?? 0),
      ...tracker(r),
      score,
    };
  })
    .filter((i) => (call ? i.call === call : true))
    /**
     * DELISTED LISTINGS ARE HIDDEN BY DEFAULT. This is the fix for the feed
     * being able to send someone to a listing that sold two weeks ago.
     *
     * `?gone=1` shows them, because "sold in 4 days at $650" is the clearing
     * evidence the outcome loop is built on and there needs to be somewhere to
     * see it.
     */
    .filter((i) => (showGone ? true : !i.gone))
    .sort((a, b) => b.score - a.score);

  // Rank globally, then page. Paging before ranking would make page 2 a
  // second-best bucket rather than the continuation of one ordered list.
  const items = ranked.slice(offset, offset + limit);

  const counts = db().query(`
    SELECT v.call, COUNT(*) n FROM verdicts v
    WHERE v.id IN (SELECT MAX(id) FROM verdicts GROUP BY listing_id)
    GROUP BY v.call`).all() as Array<{ call: string; n: number }>;

  const lastCrawl = db().query("SELECT started_at, analysed FROM crawls ORDER BY id DESC LIMIT 1").get() as any;

  return c.json({
    items,
    // `total` is the count AFTER filters, so the UI can page honestly instead
    // of implying the page is everything.
    total: ranked.length,
    offset,
    limit,
    counts: Object.fromEntries(counts.map((x) => [x.call, x.n])),
    lastCrawl: lastCrawl ?? null,
    void: cat,
  });
});

/** A previously-run check, by listing id. Shareable permalink target. */
/**
 * The watchlist: current state for a set of listing ids.
 *
 * **THE WATCHLIST LIVES IN THE BROWSER, and that is a deliberate choice.** The
 * ids are in localStorage, and this endpoint answers "what happened to these"
 * without knowing who is asking. Saving a listing therefore needs no account,
 * no signup and no row tied to a person — which is the difference between a
 * feature you can ship today and one that waits on auth.
 *
 * The tradeoff is honest and stated in the UI: a saved list does not follow you
 * to another device. When accounts exist, this endpoint does not change — only
 * where the id list comes from.
 *
 * It returns what the tracker knows, because a saved listing is only worth
 * saving if it can tell you the price fell or the thing is gone. That is the
 * entire reason the sweep exists.
 */
app.get("/v1/watchlist", (c) => {
  const raw = (c.req.query("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  // Bounded: this is a public GET taking a caller-supplied id list, and an
  // unbounded IN clause is a way to make one request read the whole table.
  const ids = [...new Set(raw)].slice(0, 200);
  if (!ids.length) return c.json({ items: [] });

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.source, l.asking_price_cents, l.location, l.posted_at,
           l.delisted_at, l.delist_reason, l.last_price_cents, l.last_seen,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb,
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at ASC LIMIT 1) first_price_cents,
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at DESC LIMIT 1) latest_price_cents
    FROM listings l
    JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
    WHERE l.id IN (${ids.map(() => "?").join(",")})
  `).all(...ids) as any[];

  const items = rows.map((r) => {
    const v = r.payload ? JSON.parse(r.payload) : null;
    return {
      id: r.id, title: r.title, url: r.url, source: r.source,
      askingPriceCents: r.asking_price_cents, location: r.location, postedAt: r.posted_at,
      thumb: r.thumb, call: r.call, confidence: r.confidence,
      headline: v?.headline ?? null,
      netProfitCents: v?.netProfitCents ?? null,
      flagCount: v?.blockers?.length ?? 0,
      ...tracker(r),
    };
  });

  /**
   * Ids the caller asked about that no longer resolve. A listing can be purged
   * from the database, and a watchlist that silently shrank would look like it
   * lost the save rather than the listing.
   */
  const found = new Set(items.map((i) => i.id));
  return c.json({
    items,
    missing: ids.filter((i) => !found.has(i)),
    summary: {
      dropped: items.filter((i) => i.priceDropCents).length,
      gone: items.filter((i) => i.gone).length,
    },
  });
});

app.get("/v1/checks/:id", (c) => {
  const id = Number(c.req.param("id"));
  const row = db()
    .query(
      `SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
              v.call, v.confidence, v.payload
       FROM listings l
       LEFT JOIN verdicts v ON v.listing_id = l.id
       WHERE l.id = $id ORDER BY v.id DESC LIMIT 1`,
    )
    .get({ $id: id }) as any;
  if (!row) return c.json({ error: "not found" }, 404);

  const photos = (db()
    .query("SELECT url FROM listing_photos WHERE listing_id=$id ORDER BY position")
    .all({ $id: id }) as Array<{ url: string }>).map((p) => p.url);

  /**
   * SIGNALS ARE RECOMPUTED, NOT STORED.
   *
   * The detail screen was rendering a verdict with no flags under it, because
   * only the verdict payload is persisted — the signal list with its evidence
   * strings never was. So "what's flagged" was permanently empty on anything
   * opened from the feed, and the risk layer, which is the actual
   * differentiator, was invisible unless you pasted the link fresh.
   *
   * `checkStored` re-runs signals, matching and valuation from the listing text
   * already in the database: no refetch, no network, about a millisecond.
   */
  let signals: unknown[] = [];
  let meta: Record<string, unknown> = {};
  try {
    const re = checkStored(id, {});
    signals = re.signals.signals;
    meta = {
      category: re.signals.category,
      listingQuality: re.signals.listingQuality,
      sellerSophistication: re.signals.sellerSophistication,
      daysOnMarket: re.signals.daysOnMarket,
      missingValueFields: re.signals.missingValueFields,
      match: {
        model: re.match.model, brand: re.match.brand, category: re.match.category,
        confidence: re.match.confidence, method: re.match.method,
        attributes: re.match.attributes,
      },
      description: re.listing.description ?? "",
    };
  } catch { /* a listing we cannot re-read still renders its stored verdict */ }

  return c.json({
    checkId: row.id,
    listing: {
      title: row.title, url: row.url, askingPriceCents: row.asking_price_cents,
      location: row.location, postedAt: row.posted_at, source: row.source, photoUrls: photos,
    },
    verdict: row.payload ? JSON.parse(row.payload) : null,
    signals,
    meta,
  });
});

// ------------------------------------------------------------------ static
// In production one service serves both the API and the built frontend. One
// deploy, one origin, no CORS. In dev Vite serves the frontend and proxies /v1
// here, so this block is inert.
const DIST = "./web/dist";
const hasBuild = existsSync(`${DIST}/index.html`);

if (hasBuild) {
  app.use("/assets/*", serveStatic({ root: DIST }));

  /**
   * ROOT-LEVEL STATIC FILES MUST BE LISTED, or the SPA fallback eats them.
   *
   * Only `/assets/*` was served, so every other real file — the manifest, the
   * service worker, every icon — fell through to `app.get("*")` and came back
   * as `index.html` with a **200**. Silently: the status looked fine and the
   * bytes were HTML.
   *
   * That defeats the whole install. Chrome fetches `/manifest.webmanifest`,
   * gets HTML, cannot parse it, and falls back to offering "Add shortcut" —
   * exactly the symptom Yish reported. It would have survived any check that
   * only looked at status codes, which is how it nearly shipped.
   *
   * Listed explicitly rather than mounting a broad `/*` static handler,
   * because a wildcard here would sit in front of the `/v1/*` API routes.
   *
   * **`path`, not `root`.** `serveStatic({ root })` strips the mount prefix
   * and resolves what remains — which for an exact-path mount is the empty
   * string, so it looks for a directory and never matches. That is why the
   * pre-existing `/favicon.ico` line never worked either. `path` names the
   * file outright, which is the form the index.html fallback below already
   * uses successfully.
   */
  for (const f of [
    "manifest.webmanifest", "sw.js", "favicon.ico", "icon.svg",
    "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
  ]) {
    app.get(`/${f}`, serveStatic({ path: `${DIST}/${f}` }));
  }

  // SPA fallback — /c/:id must survive a hard refresh and a shared link.
  app.get("*", serveStatic({ path: `${DIST}/index.html` }));
}

// -------------------------------------------------------------- boot seed
// Deferred and fully guarded. Previously this ran at module load and any failure
// (a missing volume, a read-only mount) meant the module never finished
// evaluating, so the server never listened at all and the platform saw nothing
// but a timeout. Start first, seed second, survive either way.
setTimeout(async () => {
  try {
    const n = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
    if (n === 0) {
      console.log("empty database — seeding catalog + economics…");
      try {
        (await import("../scripts/seed.ts")).seed();
      } catch (e) {
        console.error("seed failed:", (e as Error).message);
      }
    }

    /**
     * THE COMPS ARCHIVE, and the reason this check is on comps and not on skus.
     *
     * Production ran for weeks reporting `comps: 0, skus: 62` — healthy, live,
     * serving the frontend, and returning INSUFFICIENT_DATA for every listing
     * because it had not one sold price to compare against. The catalog seed
     * above had run and "succeeded", so every empty-database check passed while
     * the engine was structurally unable to do its job.
     *
     * Nothing reported it. `/v1/health` said `ok: true`. The check that matters
     * is the one on the thing that was actually missing.
     */
    /**
     * ⚠ EACH BOOT STEP GETS ITS OWN CATCH.
     *
     * All of this used to sit under ONE try/catch whose handler said
     * "DATABASE UNAVAILABLE". So a failure in the archive import — which has
     * nothing to do with the volume — was reported as a database problem AND
     * skipped everything after it, including `startCrawlLoop`. Production ran
     * for 13 hours with no crawl, no sweep and no import, serving happily,
     * with one misleading log line as the only trace.
     *
     * The steps are independent: a bad archive must not stop the crawler, and
     * a crawler that will not start must not hide why the archive is stale.
     */
    try {
      const imported = (await import("../db/archive.ts")).importArchiveIfThin();
      if (imported) {
        console.log(
          `archive imported — +${imported.comps} comps, +${imported.skus} skus, ` +
          `+${imported.aliases} aliases, +${imported.retail} retail`,
        );
      }
    } catch (e) {
      console.error("ARCHIVE IMPORT FAILED — production will serve stale comps");
      console.error(`  ${(e as Error).stack ?? (e as Error).message}`);
    }

    const comps = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
    const skus = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
    console.log(`database ready — ${skus} skus · ${comps} comps`);
    if (comps === 0) {
      console.error("WARNING: zero comps. Every verdict will be INSUFFICIENT_DATA.");
      console.error("  Run `bun run archive` locally, commit data/archive.json.gz, redeploy.");
    }

    /**
     * The feed has to REFRESH or the site is a search box with three stale
     * listings on it — which is exactly what it was. Craigslist only; Facebook
     * needs a logged-in browser and cannot run here. See `scheduler.ts`.
     */
    try {
      (await import("./scheduler.ts")).startCrawlLoop();
    } catch (e) {
      // The feed goes stale rather than the process dying, and the reason is
      // named. This is where a bad dynamic import (a new dependency missing
      // from the image, say) would surface.
      console.error("CRAWL LOOP FAILED TO START — the feed will not refresh");
      console.error(`  ${(e as Error).stack ?? (e as Error).message}`);
    }
  } catch (e) {
    console.error(`DATABASE UNAVAILABLE at ${DB_PATH}: ${(e as Error).message}`);
    console.error("  The server is still serving. Fix the volume mount or ASSYZE_DB.");
  }
}, 0);

const port = Number(process.env.PORT) || 3177;
// Bind all interfaces. Binding loopback inside a container makes the app
// invisible to the platform's healthcheck even though it "started fine".
const hostname = "0.0.0.0";
console.log(
  `assyze  ${hostname}:${port}  engine ${ENGINE_VERSION}  ` +
  `${hasBuild ? "serving web/dist" : "api only (dev)"}  db=${DB_PATH}`,
);
export default { port, hostname, fetch: app.fetch, idleTimeout: 120 };
