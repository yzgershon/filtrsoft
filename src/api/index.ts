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
import {
  applyDiscovery, applyQuality, parseDrive, parseFilters, segmentCounts, sortFeed,
} from "./query.ts";
import { detectCategory } from "../signals/index.ts";
import { handleDeletionChallenge, handleDeletionNotice, deletionEndpoint, deletionConfigured } from "./ebay-deletion.ts";
import {
  handleVapid, handleSubscribe, handleListSearches, handleCreateSearch,
  handleDeleteSearch, handleTestPush, pushConfigured, ensureAlertTables, pushStatus,
} from "./alerts.ts";
import {
  handleBillingStatus, handleCheckout, handlePortal, handleWebhook, billingEnabled,
} from "./billing.ts";
import { getEconomics } from "../valuation/index.ts";
import { db, DB_PATH } from "../db/index.ts";
import { getThumb, thumbStats, pruneThumbs, THUMBS_OFF } from "../photos/thumb.ts";
import {
  loadOverrides, applyOverride, handleSetOverride, handleClearOverride,
} from "./overrides.ts";
import { archiveStatus } from "../db/archive.ts";
import { VISION_MODEL, visionConfigured } from "../vision/index.ts";
import {
  rateLimit, clientKey, visionAllowed, visionKilled, budgetAvailable,
  singleFlight, guardStatus,
} from "./guard.ts";

const app = new Hono();

/** Facet counts, so a filter chip never offers a value with nothing behind it. */
function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

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
    push: pushStatus(),
    /**
     * What the SHIPPED archive holds, vs what the database holds. If
     * `archive.comps` exceeds `comps`, the file arrived and the import did not
     * run — which is invisible any other way.
     */
    archive: archiveStatus(),
    billing: { enabled: billingEnabled() },
    /**
     * ⚠ THE THUMBNAIL CACHE REPORTS ITS OWN SIZE, AND IT DOES SO BECAUSE THE
     * LAST TIME THIS PROJECT PUT IMAGES ON THE VOLUME IT FILLED UP AND TOOK
     * THE CRAWLER DOWN FOR 13 HOURS WITH NO SIGNAL ANYWHERE.
     *
     * The feed kept serving the whole time, so every surface said healthy. One
     * number here is the difference between noticing at 20 MB and noticing at
     * the disk limit. See `photos/thumb.ts` for the bounds that keep it small.
     */
    /**
     * ⚠ WHEN THE DELISTING SWEEP LAST RAN, because it starved for days without
     * a single surface saying so.
     *
     * Its first run was scheduled from BOOT, not from the last sweep, so on a
     * service that deploys often every restart pushed it further out and a
     * deploy inside the window reset it again. Production had marked 7 of 725
     * listings delisted while every log line said the loop had started. One
     * number here is the difference between noticing and not.
     */
    sweep: (() => {
      try {
        const r = db().query(
          "SELECT started_at, seen, probed, delisted FROM sweeps ORDER BY id DESC LIMIT 1",
        ).get() as any;
        if (!r) return { lastAt: null, hoursAgo: null };
        return {
          lastAt: r.started_at,
          hoursAgo: Math.round((Date.now() - Date.parse(r.started_at)) / 3600_000),
          seen: r.seen, probed: r.probed, delisted: r.delisted,
        };
      } catch { return { error: "unavailable" }; }
    })(),
    thumbs: THUMBS_OFF ? { enabled: false } : (() => {
      try {
        const t = thumbStats();
        return { enabled: true, count: t.count, mb: Math.round((t.bytes / 1e6) * 10) / 10 };
      } catch { return { enabled: true, error: "unavailable" }; }
    })(),
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

/**
 * The url a card should load its image from.
 *
 * ⚠ OUR OWN COPY WINS WHENEVER WE HAVE ONE, AND THAT IS THE WHOLE POINT.
 *
 * Facebook signs its CDN urls with a ~2-day life — measured on the live feed:
 * every 403 carried an `oe=` expiry in the past, every 200 one about 40 hours
 * ahead. The feed keeps a listing for 28 days, so past day two a Facebook card
 * is guaranteed to render a broken image and no amount of retrying helps. See
 * `photos/thumb.ts` for why a 20 KB cached thumbnail is not the full-photo
 * retention that filled the volume in 2026-08.
 *
 * The remote url stays the fallback, so a listing we have not cached yet still
 * shows its photo rather than nothing.
 */
const thumbUrl = (r: { id: number; has_thumb?: number; thumb?: string | null }) =>
  r.has_thumb ? `/v1/thumb/${r.id}` : r.thumb ?? null;

/**
 * A cached thumbnail. Immutable for a day: the bytes only change when the
 * listing's photos do, and a card that re-downloads its image on every feed
 * render would spend the saving this exists to make.
 */
/**
 * His own call on a listing. See `api/overrides.ts` — device-scoped, stored
 * separately from `verdicts` so a re-score cannot erase it.
 */
app.post("/v1/checks/:id/override", handleSetOverride);
app.delete("/v1/checks/:id/override", handleClearOverride);

/**
 * Everything he has bought with Assyze's help.
 *
 * Yish, 2026-08-31: *"add a section in Assyze where it shows all of my
 * purchases with the help of assyze."*
 *
 * ⚠ IT JOINS THE PRICE HE PAID TO WHAT THE ENGINE SAID IT WAS WORTH, and that
 * pairing is the whole feature. A list of things you bought is a receipt; a
 * list of what you paid against what the engine valued them at is the product
 * scoring itself in public. The first row in this table is an i9-12900K he
 * talked down from $200 to $170 against a $287 median — and the engine had
 * called it FAIR, "doesn't pay for the trip". Both numbers belong on screen.
 *
 * ⚠ NOT SCOPED TO A DEVICE REF, unlike overrides. `outcomes` predates the ref
 * and has no column for it, and a purchase is not a public write — it comes
 * from the outcome prompt, which only someone using the app ever sees. Adding
 * scoping later means a migration, not a redesign.
 */
app.get("/v1/purchases", (c) => {
  const rows = db().query(`
    SELECT o.id, o.listing_id, o.action, o.purchase_price_cents, o.notes, o.created_at,
           o.sold_price_cents, o.sold_channel, o.sold_at,
           l.title, l.url, l.source, l.location, l.asking_price_cents,
           v.call, v.payload,
           EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = l.id) has_thumb,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb
      FROM outcomes o
      JOIN listings l ON l.id = o.listing_id
      LEFT JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
     WHERE o.action = 'bought'
     ORDER BY o.created_at DESC
     LIMIT 200
  `).all() as any[];

  const items = rows.map((r) => {
    const v = r.payload ? JSON.parse(r.payload) : null;
    const paid = r.purchase_price_cents ?? r.asking_price_cents ?? null;
    /**
     * What it is worth is the LOCAL number, not the eBay gross. Every headline
     * in this app quotes the channel he actually uses, and a purchases screen
     * that quoted a bigger number than the listing did would be the one place
     * the product flattered itself.
     */
    const local = (v?.channels ?? []).find((ch: any) => ch.channel === "facebook" && ch.available);
    const worth = local?.netCents ?? v?.valuation?.medianCents ?? null;
    return {
      id: r.id, listingId: r.listing_id, title: r.title, url: r.url,
      source: r.source, location: r.location,
      thumb: r.has_thumb ? `/v1/thumb/${r.listing_id}` : r.thumb ?? null,
      askingPriceCents: r.asking_price_cents,
      paidCents: paid,
      worthCents: worth,
      marginCents: worth != null && paid != null ? worth - paid : null,
      engineCall: r.call ?? null,
      soldPriceCents: r.sold_price_cents ?? null,
      soldChannel: r.sold_channel ?? null,
      soldAt: r.sold_at ?? null,
      notes: r.notes ?? null,
      boughtAt: r.created_at,
    };
  });

  const spent = items.reduce((a, i) => a + (i.paidCents ?? 0), 0);
  const worth = items.reduce((a, i) => a + (i.worthCents ?? 0), 0);
  return c.json({
    items,
    summary: { count: items.length, spentCents: spent, worthCents: worth, marginCents: worth - spent },
  });
});

app.get("/v1/thumb/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.text("bad id", 400);
  const t = getThumb(id);
  if (!t) return c.text("no thumbnail", 404);
  return new Response(t.bytes, {
    headers: {
      "content-type": t.mime,
      "cache-control": "public, max-age=86400",
      "content-length": String(t.length),
    },
  });
});

app.get("/v1/feed", (c) => {
  const call = c.req.query("call");           // optional filter
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
  /**
   * ⚠ FILTERING MOVED TO THE SERVER, AND THE COUNTS COME FROM THE SAME PLACE.
   *
   * The frontend used to fetch 60 rows, filter THOSE in the browser, and hide
   * "Show more" outside the All segment. Measured on the live feed: the Deals
   * control promised 20 and the view dead-ended at 13, with seven listings
   * unreachable by any interaction. A label that says 20 while the page can
   * only ever show 13 is the interface lying about its own data.
   *
   * The counts were a second, independent lie: they were `COUNT(*) GROUP BY
   * call` over EVERY verdict in the database, including 597 OUT_OF_SCOPE rows
   * and everything older than 28 days — a population the feed itself excludes.
   * They are computed from the ranked, filtered set now, so a segment number
   * and its reachable rows cannot disagree.
   */
  /**
   * ⚠ ONE FILTER MODEL, PARSED ONCE. `parseFilters` is shared with the tests
   * and mirrored by the client's URL state, so a control cannot ask for
   * something the server does not understand and silently get everything back.
   */
  const filters = parseFilters((k) => c.req.query(k));
  const { quality } = filters;
  const overrides = loadOverrides(c.req.query("ref"));

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
           l.delisted_at, l.delist_reason, l.last_price_cents, l.last_seen,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb,
           EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = l.id) has_thumb,
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
  /**
   * Yish's order, 2026-08-28: **BUY, VERIFY, RISK, FAIR, PASS, and CAN'T TELL
   * LAST.**
   *
   * `INSUFFICIENT_DATA` used to rank 3rd, above RISK and PASS, so the largest
   * and least useful bucket on the site sat in the middle of the feed and
   * pushed real verdicts below the fold. "We could not price this" is the one
   * answer that can never be acted on — it belongs at the bottom, behind even
   * the listings we priced and rejected.
   */
  const RANK: Record<string, number> = { BUY: 0, VERIFY: 1, RISK: 2, FAIR: 3, PASS: 4, INSUFFICIENT_DATA: 5 };
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
      /**
       * Derived here rather than stored. `listings` has no category column and
       * the verdict payload does not carry one, so the alternative is a
       * migration plus a backfill for a value `detectCategory` recomputes from
       * the title in microseconds. It is also the SAME function the engine
       * classifies with, so the filter cannot disagree with the verdict.
       */
      category: detectCategory(r.title ?? "", ""),
      askingPriceCents: r.asking_price_cents, location: r.location, postedAt: r.posted_at,
      thumb: thumbUrl(r), call: r.call, confidence: r.confidence,
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
    /**
     * ⚠ HIS OWN CALL REPLACES THE ENGINE'S *BEFORE* THE COUNTS ARE TAKEN.
     *
     * A listing he relabelled has to leave the segment it was in and join the
     * one he chose — in the rows AND in the chip counts. Applying it any later
     * than here would leave "Risky 25" beside a list of 26, which is the exact
     * lie `segmentCounts`' invariant exists to prevent. See `api/overrides.ts`
     * for why these are scoped to a device rather than global.
     */
    .map((i) => applyOverride(i, overrides))
    .sort((a, b) => b.score - a.score);

  // Rank globally, then page. Paging before ranking would make page 2 a
  // second-best bucket rather than the continuation of one ordered list.
  /**
   * ⚠ THE COUNTS AND THE PAGE COME FROM ONE POPULATION.
   *
   * `priceScoped` is filtered ONCE; the segment counts and the served rows are
   * both derived from it. When those were two separate expressions the Deals
   * control said 20 while the view dead-ended at 13. The segment vocabulary and
   * the invariant that ties them together live in `./query.ts`, where a test
   * asserts `segmentCounts(rows)[q] === applyQuality(rows, q).length`.
   */
  /**
   * ⚠ THE SEGMENT COUNTS ARE COMPUTED OVER THE DISCOVERY-FILTERED SET.
   *
   * Search for "rtx" and the chips must say how many BUYs there are AMONG RTX
   * cards, not in the whole feed. Counting the unfiltered population would put
   * "Ready 3" above a search that returns one, which is the same class of lie
   * the segment rewrite existed to remove: a number you cannot reach.
   */
  const scoped = sortFeed(applyDiscovery(ranked, filters), filters.sort);
  const filtered = applyQuality(scoped, quality);
  const items = filtered.slice(offset, offset + limit);
  const segments = segmentCounts(scoped);

  /**
   * ⚠ WHEN THE FEED LAST MOVED, AND HOW MUCH — because "when should I look?"
   * had no answer anywhere in the product.
   *
   * Yish, 2026-08-31: *"I want to understand better when new listings get added
   * to Assyze because I want to know when to look at Assyze, and eventually it
   * would be great if new listings were being added like every 5 minutes."*
   *
   * It ALREADY runs every three minutes (`ASSYZE_CRAWL_INTERVAL_MS`, scheduler
   * line 45). The gap was never the cadence, it was that nothing on screen said
   * so — `lastCrawl` has been in this response the whole time and no component
   * ever read it. A crawler you cannot see is one you assume is broken.
   *
   * `freshCount` is the number that actually answers his question: not when a
   * crawl ran, but how much it FOUND. A tick that adds nothing is not a reason
   * to open the app.
   */
  const lastCrawl = db().query("SELECT started_at, analysed FROM crawls ORDER BY id DESC LIMIT 1").get() as any;
  const freshCount = (db().query(
    `SELECT COUNT(*) n FROM listings
      WHERE delisted_at IS NULL AND captured_at >= datetime('now', '-1 hour')`,
  ).get() as { n: number }).n;

  return c.json({
    items,
    /**
     * `total` is the count for THIS query — same filters, same population as
     * `items`. The UI pages until `items.length === total`, so every number it
     * prints is reachable.
     */
    total: filtered.length,
    offset,
    limit,
    quality,
    segments,
    filters,
    /**
     * The facets that actually have rows behind them, counted over the
     * price/search-scoped set. Offering "Mercari (0)" is offering a dead end.
     */
    facets: {
      category: countBy(scoped, (r) => r.category),
      source: countBy(scoped, (r) => r.source),
    },
    // Raw call counts over the same ranked set, for anything that still wants
    // them. NOT the global verdict table, which counts rows the feed hides.
    counts: Object.fromEntries(
      ["BUY", "VERIFY", "RISK", "FAIR", "PASS", "INSUFFICIENT_DATA"]
        .map((k) => [k, ranked.filter((i) => i.call === k).length]),
    ),
    lastCrawl: lastCrawl ?? null,
    /** New listings in the last hour, and how often the crawler runs. */
    freshCount,
    crawlEveryMs: Number(process.env.ASSYZE_CRAWL_INTERVAL_MS ?? 3 * 60 * 1000),
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
           EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = l.id) has_thumb,
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
      thumb: thumbUrl(r), call: r.call, confidence: r.confidence,
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
  /**
   * ⚠ DRIVE TIME IS A PER-REQUEST OVERRIDE, AND THAT IS DELIBERATE.
   *
   * The Settings stepper wrote `driveMinutes` to localStorage and NOTHING read
   * it — the verdict economics never changed, so the control moved a number on
   * screen and lied about what it did (audit P0-3).
   *
   * It is applied HERE and not to the stored verdict, because the audit's own
   * warning applies: a user-specific engine input would have to enter the
   * verdict cache key or force a re-score, and one shared row per listing
   * cannot express per-user answers. `checkStored` recomputes from text already
   * in the database in about a millisecond, so the detail screen can honour it
   * without the feed's precomputed rows becoming wrong for everyone else.
   */
  const driveMinutes = parseDrive(c.req.query("drive"));

  let signals: unknown[] = [];
  let comps: unknown[] = [];
  let meta: Record<string, unknown> = {};
  let verdict = row.payload ? JSON.parse(row.payload) : null;

  try {
    const re = checkStored(id, driveMinutes ? { driveMinutes } : {});
    // Only replace the stored verdict when the caller actually asked for a
    // different drive time; otherwise the feed and the detail must agree.
    if (driveMinutes) verdict = re.verdict;
    signals = re.signals.signals;
    /**
     * ⚠ THE COMPS BEHIND THE MEDIAN, NAMED (audit §20 "comp transparency").
     *
     * Every number on the detail screen descends from one median, and the
     * screen said "59 sold comps" without ever showing one. That asks for
     * trust on the strength of a count. Yish's own valuation dispute on the
     * NZXT build was settled by looking at what the comps actually WERE, which
     * is not something the product let anyone else do.
     *
     * Capped at 12 and ordered newest-first: this is evidence for a judgement,
     * not a data export, and 59 rows would bury the verdict above it.
     */
    if (re.match?.skuId) {
      comps = db().query(
        `SELECT raw_title, sold_price_cents + COALESCE(shipping_cents,0) AS total,
                condition_norm, sold_at, url
           FROM comps WHERE sku_id = $sku AND sold_price_cents > 0
          ORDER BY COALESCE(sold_at, captured_at) DESC LIMIT 12`,
      ).all({ $sku: re.match.skuId }) as unknown[];
    }
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

  /**
   * ⚠ HIS CALL WINS, AND IT IS APPLIED *AFTER* THE RE-SCORE, NOT BEFORE.
   *
   * The web app always sends `?drive=` (see `checkQuery` in nav.ts), so the
   * branch above always replaces `verdict` with a freshly computed one.
   * Applying the override any earlier means it is silently overwritten on every
   * single request from the actual product — the control would appear to work,
   * the row would be written, and the screen would keep showing the engine's
   * answer.
   *
   * `overriddenFrom` carries what the engine said. Without it the screen
   * presents his own judgement back to him as the engine's, and knowing which
   * listings he has personally checked is the entire point. See
   * `api/overrides.ts`.
   */
  const ov = loadOverrides(c.req.query("ref")).get(id);
  if (ov && verdict && ov.call !== verdict.call) {
    verdict = { ...verdict, call: ov.call, overriddenFrom: verdict.call, overrideNote: ov.note };
  }

  return c.json({
    checkId: row.id,
    listing: {
      title: row.title, url: row.url, askingPriceCents: row.asking_price_cents,
      location: row.location, postedAt: row.posted_at, source: row.source, photoUrls: photos,
    },
    verdict,
    signals,
    comps,
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
