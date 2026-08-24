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
import { getEconomics } from "../valuation/index.ts";
import { db } from "../db/index.ts";
import { accountStatus } from "../vision/accounts.ts";

const app = new Hono();
app.use("/*", cors());

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

app.get("/v1/health", (c) =>
  c.json({
    ok: true,
    engine: ENGINE_VERSION,
    comps: (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n,
    skus: (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n,
    // Vision runs on subscriptions, so account health IS service health.
    visionAccounts: accountStatus(),
  }),
);

/** One-shot check. Text-only by default, which is the fast path. */
app.post("/v1/checks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const err = badUrl(body.url);
  if (err) return c.json({ error: err }, 400);

  try {
    const r = await checkListing(body.url, {
      vision: Boolean(body.vision),
      persist: true,
      driveMinutes: body.driveMinutes,
      econ: body.economics ?? getEconomics(),
    });
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
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Streaming check. One SSE event per stage. */
app.get("/v1/checks/stream", (c) => {
  const url = c.req.query("url");
  const err = badUrl(url);
  // Vision is the product. Opt OUT with ?vision=0, do not opt in.
  const vision = c.req.query("vision") !== "0";
  const drive = Number(c.req.query("drive")) || undefined;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      if (err) { send("error", { error: err }); ctrl.close(); return; }

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
app.get("/v1/feed", (c) => {
  const call = c.req.query("call");           // optional filter
  const cat = c.req.query("category");
  const limit = Math.min(Number(c.req.query("limit")) || 40, 100);

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb
    FROM listings l
    JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
    WHERE v.call NOT IN ('OUT_OF_SCOPE')
    ORDER BY l.posted_at DESC
    LIMIT 400
  `).all() as any[];

  // Rank in JS — the score needs fields that live inside the verdict JSON.
  const RANK: Record<string, number> = { BUY: 0, VERIFY: 1, FAIR: 2, INSUFFICIENT_DATA: 3, RISK: 4, PASS: 5 };
  const items = rows.map((r) => {
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
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const counts = db().query(`
    SELECT v.call, COUNT(*) n FROM verdicts v
    WHERE v.id IN (SELECT MAX(id) FROM verdicts GROUP BY listing_id)
    GROUP BY v.call`).all() as Array<{ call: string; n: number }>;

  const lastCrawl = db().query("SELECT started_at, analysed FROM crawls ORDER BY id DESC LIMIT 1").get() as any;

  return c.json({
    items,
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
  app.use("/favicon.ico", serveStatic({ root: DIST }));
  // SPA fallback — /c/:id must survive a hard refresh and a shared link.
  app.get("*", serveStatic({ path: `${DIST}/index.html` }));
}

// -------------------------------------------------------------- boot seed
// A fresh Railway volume is an empty database. Seed the catalog and economics
// on first boot rather than requiring a manual step nobody remembers.
{
  const n = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
  if (n === 0) {
    console.log("empty database — seeding catalog + economics…");
    const { seed } = await import("../scripts/seed.ts");
    try { seed(); } catch (e) { console.error("seed failed:", (e as Error).message); }
  }
}

const port = Number(process.env.PORT) || 3177;
console.log(
  `assyze  :${port}  engine ${ENGINE_VERSION}  ${hasBuild ? "serving web/dist" : "api only (dev)"}`,
);
export default { port, fetch: app.fetch, idleTimeout: 120 };
