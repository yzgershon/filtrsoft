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
import { checkListing, ENGINE_VERSION, type Stage } from "../engine/index.ts";
import { handlePush } from "./push.ts";
import { getEconomics } from "../valuation/index.ts";
import { db, DB_PATH } from "../db/index.ts";
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

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb
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
    const score = (10 - (RANK[r.call] ?? 9)) * 1000 + Math.min(net / 100, 500) + freshness * 200;
    return {
      id: r.id, title: r.title, url: r.url, source: r.source,
      askingPriceCents: r.asking_price_cents, location: r.location, postedAt: r.posted_at,
      thumb: r.thumb, call: r.call, confidence: r.confidence,
      headline: v?.headline ?? null,
      netProfitCents: v?.netProfitCents ?? null,
      flagCount: (v?.blockers?.length ?? 0),
      score,
    };
  })
    .filter((i) => (call ? i.call === call : true))
    .filter((i) => (cat ? true : true))
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

  return c.json({
    checkId: row.id,
    listing: {
      title: row.title, url: row.url, askingPriceCents: row.asking_price_cents,
      location: row.location, postedAt: row.posted_at, source: row.source, photoUrls: photos,
    },
    verdict: row.payload ? JSON.parse(row.payload) : null,
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
    const imported = (await import("../db/archive.ts")).importArchiveIfThin();
    if (imported) {
      console.log(
        `archive imported — +${imported.comps} comps, +${imported.skus} skus, ` +
        `+${imported.aliases} aliases, +${imported.retail} retail`,
      );
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
    (await import("./scheduler.ts")).startCrawlLoop();
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
