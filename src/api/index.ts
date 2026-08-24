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
import { checkListing, ENGINE_VERSION, type Stage } from "../engine/index.ts";
import { getEconomics } from "../valuation/index.ts";
import { db } from "../db/index.ts";

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
  const vision = c.req.query("vision") === "1";
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

const port = Number(process.env.PORT) || 3177;
console.log(`assyze api  http://localhost:${port}  (engine ${ENGINE_VERSION})`);
export default { port, fetch: app.fetch, idleTimeout: 120 };
