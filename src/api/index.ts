import { dismissedIds, setDismissed, listDismissed } from "./dismissals.ts";
import { specifications } from "../engine/specifications.ts";
import {handleComparison,handleComparisonCandidates} from './compare.ts';
import { handlePurchases } from "./purchases.ts";
import {rememberDecision,decisionAt,decisionSku} from "../db/learning.ts";
import {feedWindow,CursorError} from "./feed-cursor.ts";
import {checkInput,outcomeInput} from "./check-input.ts";
import {scoringStatus} from "../db/scoring.ts";
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
  applyDiscovery, applyQuality, parseFilters, segmentCounts, sortFeed,
  newSegmentCounts, parseSeen,
} from "./query.ts";
import { detectCategory } from "../signals/index.ts";
import { handleDeletionChallenge, handleDeletionNotice, deletionEndpoint, deletionConfigured } from "./ebay-deletion.ts";
import {
  handleVapid, handleSubscribe, handleListSearches, handleCreateSearch,
  handleDeleteSearch, handleUpdateSearch, handleTestPush, pushConfigured, ensureAlertTables, pushStatus,
  alertStatus,
  handleUpdateStanding,
} from "./alerts.ts";
import {
  handleBillingStatus, handleCheckout, handlePortal, handleWebhook, billingEnabled,
} from "./billing.ts";
import {
  handleSignup, handleSignin, handleSignout, handleMe, handleGoogle, handleApple,
  currentUser, ownsDevice, authProviders, pruneSessions,
} from "./auth.ts";
import { getEconomics } from "../valuation/index.ts";
import { db, DB_PATH } from "../db/index.ts";
import { isoAgo } from "../db/time.ts";
import { getThumb, thumbStats, pruneThumbs, THUMBS_OFF } from "../photos/thumb.ts";
import {
  loadAccountOverrides, applyOverride, handleSetOverride, handleClearOverride,
} from "./overrides.ts";
import { archiveStatus } from "../db/archive.ts";
import { compsHealth, visionHealth,pipelineFunnel } from "./pipeline-health.ts";
import { visionLoopEnabled, crawlPaceMode } from "./scheduler.ts";
import { lastVisionPass } from "../crawler/vision-pass.ts";
import {
  handleStartCrawl, handleLatestJob, handleNextJob, handleJobUpdate, crawlPinConfigured,
  autoCrawlStatus,
} from "./jobs.ts";
import { VISION_MODEL, PROMPT_VERSION, visionConfigured } from "../vision/index.ts";
import {
  rateLimit, clientKey, visionAllowed, visionKilled, budgetAvailable,
  singleFlight, guardStatus,
} from "./guard.ts";

export const app = new Hono();

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
  "https://filtrsoft.com", "https://www.filtrsoft.com",
  "http://localhost:5177", "http://127.0.0.1:5177",
];
app.use("/*", cors({ origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null) }));

/**
 * ONE CANONICAL HOST, AND A PROMISE NEVER TO SPEAK HTTP AGAIN.
 *
 * ── WHY HSTS, CONCRETELY ───────────────────────────────────────────────────
 *
 * Railway already 301s http -> https, but a 301 is a RESPONSE — the browser has
 * to make the plaintext request first to receive it, and whatever it has cached
 * for `http://filtrsoft.com/` wins before any of that happens. On 2026-09-04,
 * hours after the domain went live, Chrome was still serving Yish the Namecheap
 * parking page for the bare hostname while `https://filtrsoft.com` loaded the
 * real app: same machine, same DNS, two different cache keys. Every other
 * client on that machine was fine, which made it look like the domain was
 * broken.
 *
 * HSTS removes the plaintext request entirely — the browser rewrites http to
 * https internally, so a stale http entry can never be consulted again.
 *
 * ⚠ IT IS A ONE-WAY DOOR FOR `max-age`. A browser that has seen this header
 * will REFUSE to reach this host over http for six months, and there is no way
 * to reach those browsers and take it back. That is safe here only because the
 * site is HTTPS-only by construction and Railway renews the certificate itself.
 * **No `preload`, and no `includeSubDomains`** — preload is effectively
 * permanent and baked into browser binaries, and a subdirective covering
 * subdomains would apply to hosts that do not exist yet.
 *
 * Set only on https responses. Sending it over plaintext is meaningless (the
 * spec says ignore it) and would be a lie on localhost.
 *
 * ── AND WHY www REDIRECTS RATHER THAN SERVES ───────────────────────────────
 *
 * `www.filtrsoft.com` became reachable when the plan gained a second custom
 * domain slot. Two hostnames both SERVING the app is not free: sessions are
 * cookie-scoped to a host, so signing in on one leaves you signed out on the
 * other, and `localStorage` — which holds Saved, history and the device ref —
 * is per-origin too. A user who reaches www once has a second, empty account
 * surface with no way to tell why. So www exists to point at the apex, nothing
 * more.
 */
app.use("/*", async (c, next) => {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");

  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    url.protocol = "https:";
    return c.redirect(url.toString(), 301);
  }

  await next();
  if (proto === "https") {
    c.header("Strict-Transport-Security", "max-age=15552000");   // 180 days
  }
});

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
 * ────────────────────────────────────────────────────── the sign-in wall
 *
 * Yish, 2026-09-01: *"right now anyone who goes to filtrsoft.com can just have
 * full access to all the deals."*
 *
 * ⚠ ENFORCED HERE, NOT IN THE UI. A React route that hides the feed is a
 * decoration: the data is one `curl` away, and the whole point of this change
 * is that the deals are the asset. So the gate is a middleware over the DATA
 * paths and the client is simply the thing that gets 401s.
 *
 * ⚠ IT IS A PREFIX LIST, AND EVERY ENTRY IS DELIBERATE:
 *
 *   · `/v1/health` stays open — it is the platform's liveness probe, and
 *     gating it makes every deploy fail its healthcheck. It exposes counts,
 *     never listings.
 *   · `/v1/auth/*` stays open, or nobody could ever sign in.
 *   · `/v1/billing/webhook` stays open because STRIPE calls it, not a browser;
 *     it is authenticated by its own signature.
 *   · `/v1/ebay/deletion` stays open for the same reason — eBay calls it.
 *   · `/v1/thumb/:id` stays open: it is an <img> src, and a cookie-gated image
 *     that 401s renders as a broken photo rather than a sign-in prompt.
 *
 * Everything else — the feed, checks, the watchlist, purchases, the pulse,
 * saved searches — is the product, and the product now needs an account.
 */
const PUBLIC_PREFIXES = [
  "/v1/health",
  "/v1/auth/",
  "/v1/billing/webhook",
  "/v1/ebay/deletion",
  "/v1/thumb/",
  "/v1/landing",
];

/**
 * ⚠ THE AGENT'S OWN ENDPOINTS, MATCHED EXACTLY RATHER THAN BY PREFIX.
 *
 * `bun run agent` on his desktop is a headless process with no browser cookie;
 * it authenticates with `FILTRSOFT_PUSH_TOKEN` inside its handlers instead. Both
 * of these have to bypass the session wall or the button queues jobs that
 * nothing ever collects.
 *
 * A prefix of `/v1/jobs/` would have been simpler and wrong: it would also
 * expose `/v1/jobs/latest`, which reports what he is crawling and when, to
 * anyone who asks. `/v1/jobs/:id` is a number, so the pattern says so.
 */
const AGENT_PATHS = [
  /^\/v1\/jobs\/next$/,
  /^\/v1\/jobs\/\d+$/,
  /**
   * ⚠ `/v1/push` EXACTLY — the listing ingest, NOT the `/v1/push/*` web-push
   * endpoints, which are browser calls and stay behind the wall.
   *
   * Adding the sign-in wall on 2026-09-01 silently broke `bun run push`: it
   * authenticates with `FILTRSOFT_PUSH_TOKEN` inside its own handler, so the
   * middleware rejected it before that ever ran. Nothing noticed for two days
   * because nothing had pushed since. Found when the crawl agent's very first
   * end-to-end run came back `push failed 401`.
   *
   * That is the whole failure mode of a blanket wall: it is correct for every
   * path a browser uses and wrong for every path a machine uses, and the
   * machine paths are the ones nobody exercises by accident.
   */
  /^\/v1\/push$/,
];

app.use("/v1/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return next();
  if (AGENT_PATHS.some((re) => re.test(path))) return next();
  if (!currentUser(c)) {
    /**
     * 401 with a machine-readable reason. The client turns this into "your
     * session expired, sign in again" rather than the generic failure banner,
     * which otherwise reads as the server being down.
     */
    return c.json({ error: "sign in to use Filtrsoft", auth: "required" }, 401);
  }
  const ref=c.req.query("ref");
  if(ref && !ownsDevice(currentUser(c)!.id,ref))return c.json({error:"device does not belong to this account"},403);
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
  let coverage:ReturnType<typeof compsHealth>|null=null;
  try {
    const comps = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
    const skus = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
    coverage=compsHealth();
    // Raw rows can all be stale, quarantined or mismatched. Readiness follows
    // the same suitable-evidence contract as valuation, not table occupancy.
    canPrice = coverage.skusPriceable > 0;
    stats = {
      db: "ok", comps, skus,
      ...(canPrice ? {} : {
        warning: "no catalog SKU has enough suitable sold evidence to price. " +
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
    /**
     * ⚠ `spentTodayUsd` ALONE CANNOT TELL YOU IF VISION WORKS. Zero means
     * either "nothing needed a photo read" or "the pass is broken", and those
     * have opposite fixes — an hour went into distinguishing them by hand on
     * 2026-09-03. `reads24h` beside `candidatePool` settles it in one glance.
     */
    vision: {
      configured: visionConfigured(), model: VISION_MODEL, ...guardStatus(),
      ...(() => { try { return visionHealth(VISION_MODEL, PROMPT_VERSION); } catch { return {}; } })(),
      /**
       * ⚠ BOTH SWITCHES, BECAUSE THEY READ DIFFERENT ENV VARS. `visionEnabled`
       * above is the kill switch (`FILTRSOFT_VISION_ENABLED`); `loopEnabled` is
       * what the crawl tick gates on (`FILTRSOFT_VISION`). Reporting one and not
       * the other is how "vision is on" and "vision never runs" coexisted.
       * `mode` matters too: the pass only runs in steady, never in backfill.
       */
      ...(() => { try { return { loopEnabled: visionLoopEnabled(), mode: crawlPaceMode() }; } catch { return {}; } })(),
      /** What the last pass actually did, including the exception nobody could see. */
      ...(() => { try { return { lastPass: lastVisionPass }; } catch { return {}; } })(),
    },
    /**
     * ⚠ THE COMPS DECAY ON THEIR OWN AND NOTHING HERE REFILLS THEM.
     * `valueSku` only counts a sale inside 90 days; the comps ship frozen in an
     * archive. So the priceable share of the catalog falls every day with no
     * error anywhere, and the symptom is a feed that slowly turns into "can't
     * tell". `daysOfRunway` is the number to watch.
     */
    comps: coverage,
    funnel:(()=>{try{return pipelineFunnel();}catch{return {error:"unavailable"};}})(),
    /**
     * Reports WHETHER the eBay verification token is set, never its value.
     * Without this the only way to know production has it is to make eBay
     * fail the challenge, which disables the keyset again.
     */
    ebay: { deletionEndpoint: deletionEndpoint(), deletionConfigured: deletionConfigured() },
    /**
     * ⚠ SUBSCRIPTION COUNT BELONGS HERE, because "push is usable" and "anything
     * is subscribed" are different facts that were reported as one. Health said
     * `usable: true` the whole time Yish was telling me alerts did not work,
     * and it was telling the truth about the VAPID keys while saying nothing
     * about whether a single device would ever receive one.
     */
    push: { ...pushStatus(), ...alertStatus() },
    /**
     * What the SHIPPED archive holds, vs what the database holds. If
     * `archive.comps` exceeds `comps`, the file arrived and the import did not
     * run — which is invisible any other way.
     */
    archive: archiveStatus(),
    scoring: scoringStatus(),
    billing: { enabled: billingEnabled() },
    crawlButton: { configured: crawlPinConfigured(), ...autoCrawlStatus() },
    /** Which sign-in methods are configured. Never the ids themselves. */
    auth: (() => { const a = authProviders(); return { password: a.password, google: a.google, apple: a.apple }; })(),
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
  const parsed=checkInput.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"Invalid check input",issues:parsed.error.issues},400);
  const body=parsed.data;
  const err = badUrl(body.url);
  if (err) return c.json({ error: err }, 400);

  const vd = visionDecision(c, Boolean(body.vision));

  try {
    // Coalesce concurrent identical work. Twenty people opening the same shared
    // link at once become ONE source fetch and ONE vision call.
    const canonical = await singleFlight(`${body.url}|${vd.allowed}`, () => checkListing(body.url, {
      vision: vd.allowed,
      persist: true,

    }));
    const personalized=body.economics || body.driveMinutes!=null;
    const r=personalized && canonical.listingId
      ? {...canonical,...checkStored(canonical.listingId,{econ:body.economics,driveMinutes:body.driveMinutes})}:canonical;
    return c.json({
      decisionToken:r.listingId?rememberDecision(r.listingId,currentUser(c)?.id,r.verdict):undefined,
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
        description: r.listing.description,
        specifications: specifications(r.verdict.provenance),
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
  const driveParam=c.req.query('drive');
  if(driveParam!=null && (!/^\d+$/.test(driveParam) || Number(driveParam)>240))return c.json({error:'drive must be an integer from 0 to 240'},400);
  const drive=driveParam==null?undefined:Number(driveParam);

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
          onStage: (s: Stage) => {
            const data=s.data as any;
            send(s.stage,{elapsedMs:s.elapsedMs,...data,...(s.stage==='done' && data.listingId?{decisionToken:rememberDecision(data.listingId,currentUser(c)?.id,data.verdict),meta:{specifications:specifications(data.verdict?.provenance)}}:{})});
          },
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
app.patch("/v1/searches/standing", handleUpdateStanding);
app.patch("/v1/searches/:id", handleUpdateSearch);

/**
 * Billing. Built, and OFF until `STRIPE_PRICE_ID` is set — see `billing.ts`
 * for why putting a paywall in front of zero users is the wrong move.
 *
 * The webhook is NOT under the CORS or rate-limit middleware by accident: it
 * is a server-to-server callback from Stripe, and rate-limiting it by client
 * IP would drop legitimate retries during exactly the burst that matters.
 */
/**
 * ─────────────────────────────────────────────────────────────────── accounts
 *
 * ⚠ THESE ARE THE ONLY UNAUTHENTICATED WRITE PATHS IN THE APP, so they carry
 * the same rate limit as the check endpoints. Sign-in has its own per-account
 * lock on top (`signinBlocked`); this one bounds signup floods, which nothing
 * else would.
 */
app.use("/v1/auth/*", async (c, next) => {
  /**
   * ⚠ `/v1/auth/me` IS EXEMPT, AND LEAVING IT IN WAS A REAL BUG.
   *
   * `me` is a READ and it runs on every single app launch and every reload —
   * it is how the shell decides whether to render the app or the marketing
   * page. Behind a 20/minute bucket, a few refreshes (or two people on one
   * office IP) get a 429, `useAuth` treats the failed request as signed-out,
   * and a signed-in user is thrown onto the landing page with no explanation.
   *
   * Caught by `ui-verify`, which opens ~10 browser contexts from one address
   * and started failing on the sixth. The limit belongs on the endpoints that
   * MINT sessions, which is what an attacker would hammer; a session lookup
   * costs one indexed SELECT.
   */
  if (new URL(c.req.url).pathname.replace(/\/$/, "") === "/v1/auth/me") return next();
  const { ok, retryAfter } = rateLimit(clientKey(c.req.raw.headers));
  if (!ok) return c.json({ error: "too many requests" }, 429, { "Retry-After": String(retryAfter) });
  await next();
});
/**
 * Public counts for the marketing page.
 *
 * ⚠ COUNTS ONLY. NEVER A LISTING, NEVER A TITLE, NEVER A PRICE. The entire
 * point of the sign-in wall is that the deals are the asset, so the page that
 * sells them must be able to say how many there are without handing one over.
 *
 * ⚠ AND THE LANDING PAGE MUST NOT INVENT THESE. Hardcoding "18,000 sold
 * prices" into the copy is wrong within a week and silently makes every other
 * claim on the page suspect, which is expensive for a page whose whole job is
 * to be believed.
 */
app.get("/v1/landing", (c) => {
  try {
    const comps = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
    const skus = (db().query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n;
    const listings = (db().query(`
      SELECT COUNT(*) n FROM listings l
      JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
      WHERE l.delisted_at IS NULL AND v.call NOT IN ('OUT_OF_SCOPE')
        AND COALESCE(l.posted_at,l.last_seen,l.captured_at) >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    `).get() as { n: number }).n;
    return c.json({ comps, skus, listings });
  } catch {
    // The page drops the numbers rather than printing zeros, which would read
    // as a dead product.
    return c.json({});
  }
});

app.post("/v1/auth/signup", handleSignup);
app.post("/v1/auth/signin", handleSignin);
app.post("/v1/auth/signout", handleSignout);
app.post("/v1/auth/google", handleGoogle);
app.post("/v1/auth/apple", handleApple);
app.get("/v1/auth/me", handleMe);

/**
 * ────────────────────────────────────────────── crawling from the app
 *
 * ⚠ `/v1/jobs/next` AND `/v1/jobs/:id` ARE AGENT ENDPOINTS AND MUST BE IN
 * `PUBLIC_PREFIXES`. The agent is a headless process on his desktop with no
 * browser cookie; it authenticates with `FILTRSOFT_PUSH_TOKEN` inside the handler
 * instead. Leaving them behind the session wall would 401 the agent forever
 * and the button would queue jobs nothing ever collects.
 */
app.post("/v1/jobs", handleStartCrawl);
app.get("/v1/jobs/latest", handleLatestJob);
app.get("/v1/jobs/next", handleNextJob);
app.post("/v1/jobs/:id", handleJobUpdate);

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
  if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing ID'},400);
  const parsed=outcomeInput.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'Invalid outcome input',issues:parsed.error.issues},400);
  const body=parsed.data;

  const owner=currentUser(c)!.id;
  const payload=JSON.stringify([id,body.action,body.pricePaidCents??null,body.notes??null,body.decisionToken??null]);
  const reply=()=>c.json({ok:true,action:body.action,totalOutcomes:(db().query("SELECT COUNT(*) n FROM outcomes WHERE user_id=?").get(owner) as {n:number}).n});
  // A committed response can be lost. Reuse the logical submission ID so a
  // retry cannot double-count a purchase or freeze a different later decision.
  if(body.requestId){
    const prior=db().query("SELECT request_payload FROM outcomes WHERE user_id=? AND request_id=?").get(owner,body.requestId) as {request_payload:string}|null;
    if(prior)return prior.request_payload===payload?reply():c.json({error:'This submission ID was already used for a different answer.'},409);
  }
  const listing = db().query("SELECT id FROM listings WHERE id=$id").get({ $id: id });
  if (!listing) return c.json({ error: "not found" }, 404);

  let decision:ReturnType<typeof decisionAt>;
  try {decision=decisionAt(id,currentUser(c)!.id,body.decisionToken);}catch(e){return c.json({error:(e as Error).message},400);}
  db().run(`INSERT INTO outcomes(listing_id,sku_id,action,purchase_price_cents,notes,created_at,user_id,decision_id,decision_json,evidence_kind,request_id,request_payload)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[id,decisionSku(decision.payload),body.action,body.pricePaidCents??null,body.notes??null,new Date().toISOString(),
      owner,decision.id,decision.payload,body.action==='dead_listing'?'reported_disappearance':'personal_report',body.requestId??null,body.requestId?payload:null]);
  return reply();
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

const photoFallbacks=(r:{thumb_candidates?:string}):string[]=>{
  try{return JSON.parse(r.thumb_candidates??'[]');}catch{return [];}
};

/**
 * A cached thumbnail. Immutable for a day: the bytes only change when the
 * listing's photos do, and a card that re-downloads its image on every feed
 * render would spend the saving this exists to make.
 */
/**
 * His own call on a listing. See `api/overrides.ts` — device-scoped, stored
 * separately from `verdicts` so a re-score cannot erase it.
 */
app.get("/v1/dismissals", listDismissed);
app.put("/v1/checks/:id/dismiss", c => setDismissed(c,true));
app.delete("/v1/checks/:id/dismiss", c => setDismissed(c,false));
app.post("/v1/checks/:id/override", handleSetOverride);
app.delete("/v1/checks/:id/override", handleClearOverride);

/**
 * Everything he has bought with Filtrsoft's help.
 *
 * Yish, 2026-08-31: *"add a section in Filtrsoft where it shows all of my
 * purchases with the help of filtrsoft."*
 *
 * ⚠ IT JOINS THE PRICE HE PAID TO WHAT THE ENGINE SAID IT WAS WORTH, and that
 * pairing is the whole feature. A list of things you bought is a receipt; a
 * list of what you paid against what the engine valued them at is the product
 * scoring itself in public. The first row in this table is an i9-12900K he
 * talked down from $200 to $170 against a $287 median — and the engine had
 * called it FAIR, "doesn't pay for the trip". Both numbers belong on screen.
 *
 * Outcomes belong to the signed-in account. Unassigned historical rows are
 * preserved privately; seeing an outcome button is not proof of ownership.
 */
app.get("/v1/purchases", handlePurchases);

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
  const limitRaw=c.req.query('limit')??'60',offsetRaw=c.req.query('offset')??'0';
  if(!/^\d+$/.test(limitRaw)||!/^\d+$/.test(offsetRaw)||Number(limitRaw)<1||Number(limitRaw)>200||!Number.isSafeInteger(Number(offsetRaw)))
    return c.json({error:'limit must be 1-200; offset must be a nonnegative integer'},400);
  const limit=Number(limitRaw),offset=Number(offsetRaw);
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
  const overrides = loadAccountOverrides(currentUser(c)!.id);
  const removed = dismissedIds(currentUser(c)!.id);

  const rows = db().query(`
    SELECT l.id, l.title, l.url, l.asking_price_cents, l.location, l.posted_at, l.source,
           l.delisted_at, l.delist_reason, l.last_price_cents, l.last_seen,
           -- captured_at: when WE first pulled the row, which is what the
           -- per-segment NEW badges count. Deliberately NOT posted_at (the
           -- seller's clock, often absent) and deliberately NOT the verdict
           -- timestamp, which every ENGINE_VERSION bump rewrites. Reasoning
           -- in newSegmentCounts, ./query.ts.
           -- (Line comments, not block comments: a backtick in a JS template
           --  literal ends the string, and every identifier here wants one.)
           l.captured_at,
           v.call, v.confidence, v.payload,
           (SELECT url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) thumb,
    (SELECT json_group_array(url) FROM (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 3)) thumb_candidates,
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
      AND COALESCE(l.posted_at,l.last_seen,l.captured_at) >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    ORDER BY l.posted_at DESC

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
  const ranked = rows.filter(r => !removed.has(r.id)).map((r) => {
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
      /** Read only by `newSegmentCounts`; harmless on the wire. */
      capturedAt: r.captured_at,
      thumb: thumbUrl(r), thumbFallbacks: photoFallbacks(r), call: r.call, confidence: r.confidence,
      headline: v?.headline ?? null,
      priceIsPlaceholder: Boolean(v?.inventory),
      netProfitCents: v?.netProfitCents ?? null,
      flagCount: (v?.blockers?.length ?? 0),
      ...tracker(r),
      score,
    };
  })
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
    .map((i) => ({ ...applyOverride(i, overrides), reviewed: overrides.has(i.id) }))
    .filter((i)=>(call?i.call===call:true))
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
  const currentScoped = sortFeed(applyDiscovery(ranked, filters), filters.sort);
  let window:ReturnType<typeof feedWindow<typeof currentScoped[number]>>;
  try {window=feedWindow(currentScoped,currentUser(c)!.id,{filters,showGone,call},c.req.query('cursor'));}
  catch(e){if(e instanceof CursorError)return c.json({error:e.message,code:'cursor_expired'},409);throw e;}
  const scoped=window.scoped,filtered=applyQuality(scoped,quality);
  const {items,nextCursor}=window.page(filtered,limit,offset);
  const segments = segmentCounts(scoped);
  /**
   * ⚠ COUNTED OVER `scoped`, THE SAME POPULATION AS `segments`.
   *
   * A badge is a promise that tapping the chip shows you those rows. Counting
   * over the unfiltered set would put "3 new" on a search that returns none —
   * the same unreachable-number lie the segment rewrite existed to remove.
   */
  const segmentsNew = newSegmentCounts(scoped, parseSeen(c.req.query("since")));

  /**
   * ⚠ WHEN THE FEED LAST MOVED, AND HOW MUCH — because "when should I look?"
   * had no answer anywhere in the product.
   *
   * Yish, 2026-08-31: *"I want to understand better when new listings get added
   * to Filtrsoft because I want to know when to look at Filtrsoft, and eventually it
   * would be great if new listings were being added like every 5 minutes."*
   *
   * It ALREADY runs every three minutes (`FILTRSOFT_CRAWL_INTERVAL_MS`, scheduler
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
      WHERE delisted_at IS NULL AND captured_at >= ?`,
  ).get(isoAgo(3_600_000)) as { n: number }).n;

  return c.json({
    items,
    /**
     * `total` is the count for THIS query — same filters, same population as
     * `items`. The UI pages until `items.length === total`, so every number it
     * prints is reachable.
     */
    total: filtered.length,
    nextCursor,
    offset,
    limit,
    quality,
    segments,
    /**
     * New-since-you-looked, per segment, for the chip badges.
     *
     * ⚠ `segmentsNew.all` EXCLUDES CAN'T-TELLS while `segments.all` includes
     * them, so `segmentsNew[q] <= segments[q]` holds but the two are NOT the
     * same filter. Reasoning is on `NEW_NEVER_COUNTED` in ./query.ts.
     */
    segmentsNew,
    /**
     * ⚠ THE WATERMARK CLOCK, AND THE CLIENT MUST STORE THIS RATHER THAN ITS
     * OWN `Date.now()`. A phone whose clock runs fast would otherwise write a
     * future watermark and report zero new listings permanently.
     */
    serverNow: new Date().toISOString(),
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
    crawlEveryMs: Number(process.env.FILTRSOFT_CRAWL_INTERVAL_MS ?? 3 * 60 * 1000),
  });
});

/**
 * ─────────────────────────────────────────────────────────────── /v1/pulse
 *
 * "Has a deal landed in the last minute?" — the query behind the in-app alert.
 *
 * ⚠ BUY ONLY BY DEFAULT, AND THAT IS THE FEATURE. Measured 2026-09-01: BUY
 * arrives **0.7 times a day**, VERIFY 2.3, and the feed as a whole ~130. An
 * alert on everything is an interruption every eleven minutes and would be
 * switched off the same day; an alert that fires five times a week is one you
 * look at every time. `?verify=1` opts into the second tier.
 *
 * ⚠ IT IS A SEPARATE ENDPOINT FROM THE FEED ON PURPOSE. This runs every 60
 * seconds per open tab. The feed ranks 1,200 rows, parses a verdict JSON for
 * each and counts five segments; this reads at most a handful of rows through
 * an indexed date comparison and returns a few hundred bytes.
 *
 * ⚠ `RISK` IS NEVER ALERTED. A scam landing is not news you interrupt someone
 * for, and `NEVER_IN_ALL` already keeps those out of the default feed.
 */
app.get("/v1/pulse", (c) => {
  const d=db(),now=new Date().toISOString(),raw=c.req.query('cursor');
  const max=(d.query('SELECT COALESCE(MAX(id),0) id FROM verdicts').get() as {id:number}).id;
  let after=0;
  if(raw!=null){if(!/^v1:\d+$/.test(raw)||!Number.isSafeInteger(Number(raw.slice(3))))return c.json({error:'Invalid pulse cursor'},400);after=Number(raw.slice(3));}
  else {
    const since=c.req.query('since');
    if(!since || !Number.isFinite(Date.parse(since)))return c.json({now,cursor:`v1:${max}`,items:[],hasMore:false});
    after=(d.query('SELECT COALESCE(MAX(id),0) id FROM verdicts WHERE created_at<=?').get(new Date(since).toISOString()) as {id:number}).id;
  }
  const calls=c.req.query('verify')==='1'?['BUY','VERIFY']:['BUY'];
  const overrides=loadAccountOverrides(currentUser(c)!.id);
  const removed=dismissedIds(currentUser(c)!.id);
  const rows=d.query(`SELECT l.id,l.title,l.asking_price_cents,l.source,v.id event_id,latest.call,
    (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 1) thumb,
    (SELECT json_group_array(url) FROM (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 3)) thumb_candidates,
    EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id=l.id) has_thumb
    FROM listings l JOIN verdicts v ON v.id=(SELECT MIN(id) FROM verdicts WHERE listing_id=l.id AND call IN (${calls.map(()=>'?').join(',')}))
    JOIN verdicts latest ON latest.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE v.id>? AND v.id<=? AND l.delisted_at IS NULL
    AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    ORDER BY v.id ASC`).all(...calls,after,max) as any[];
  const eligible=rows.filter(r=>!removed.has(r.id)).map(r=>({...applyOverride({id:r.id,title:r.title,call:r.call,askingPriceCents:r.asking_price_cents,source:r.source,thumb:thumbUrl(r),thumbFallbacks:photoFallbacks(r)},overrides),eventId:r.event_id}))
    .filter(r=>calls.includes(r.call));
  const page=eligible.slice(0,20),hasMore=eligible.length>page.length;
  const cursor=`v1:${hasMore?page.at(-1)!.eventId:max}`;
  const items=page.sort((a,b)=>(a.call==='BUY'?0:1)-(b.call==='BUY'?0:1));
  return c.json({now,cursor,hasMore,items});
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
  const removed = dismissedIds(currentUser(c)!.id);
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
    (SELECT json_group_array(url) FROM (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 3)) thumb_candidates,
           EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = l.id) has_thumb,
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at ASC LIMIT 1) first_price_cents,
           (SELECT price_cents FROM listing_prices lp WHERE lp.listing_id = l.id
             AND lp.price_cents > 0 ORDER BY lp.observed_at DESC LIMIT 1) latest_price_cents
    FROM listings l
    JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
    WHERE l.id IN (${ids.map(() => "?").join(",")})
  `).all(...ids) as any[];

  const items = rows.filter(r => !removed.has(r.id)).map((r) => {
    const v = r.payload ? JSON.parse(r.payload) : null;
    return {
      id: r.id, title: r.title, url: r.url, source: r.source,
      askingPriceCents: r.asking_price_cents, location: r.location, postedAt: r.posted_at,
      thumb: thumbUrl(r), thumbFallbacks: photoFallbacks(r), call: r.call, confidence: r.confidence,
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

app.get('/v1/compare/candidates',handleComparisonCandidates);
app.get('/v1/compare',handleComparison);

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

  const driveRaw=c.req.query('drive');
  if(driveRaw!=null && (!/^\d+$/.test(driveRaw) || Number(driveRaw)>240))return c.json({error:'drive must be an integer from 0 to 240'},400);
  let verdict = row.payload ? JSON.parse(row.payload) : null;
  let projection=false;
  if(driveRaw!=null) {
    try {verdict=checkStored(id,{driveMinutes:Number(driveRaw)}).verdict;projection=true;}
    catch {return c.json({error:'Could not calculate requested drive-time projection'},503);}
  }
  const proof=verdict?.provenance;
  const signals=proof?.signals?.signals??[];
  const comps=(verdict?.valuation?.evidence??[]).map((e:any)=>({...e,total:e.adjustedTotalCents}));
  const meta=proof?{category:proof.signals.category,listingQuality:proof.signals.listingQuality,
    sellerSophistication:proof.signals.sellerSophistication,daysOnMarket:proof.signals.daysOnMarket,
    missingValueFields:proof.signals.missingValueFields,match:proof.match,description:proof.facts.description,
    evidenceStatus:'recorded',projection}:{evidenceStatus:'unavailable_for_legacy_decision',projection:false};

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
  const decisionToken=rememberDecision(id,currentUser(c)?.id,verdict);
  const ov = loadAccountOverrides(currentUser(c)!.id).get(id);
  if (ov && verdict && ov.call !== verdict.call) {
    verdict = { ...verdict, call: ov.call, overriddenFrom: verdict.call, overrideNote: ov.note };
  }

  return c.json({
    decisionToken,
    checkId: row.id,
    listing: {
      title: proof?.facts.title??row.title, url: row.url, askingPriceCents: proof?proof.facts.askingPriceCents:row.asking_price_cents,
      location: proof?.facts.location??row.location, postedAt: proof?.facts.postedAt??row.posted_at, source: row.source, photoUrls: proof?.facts.photoUrls??photos,
    },
    verdict,
    signals,
    comps,
    meta: {...meta, dismissed: dismissedIds(currentUser(c)!.id).has(id), specifications: verdict?.inventory ? {fields:[],photoStatus:proof?.visionEvidence?"recorded":"not_read",notes:["This listing contains multiple items. Use each offer’s exact seller wording below."],attributes:[]} : specifications(proof)},
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
if (import.meta.main) setTimeout(async () => {
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
    console.error("  The server is still serving. Fix the volume mount or FILTRSOFT_DB.");
  }
}, 0);

const port = Number(process.env.PORT) || 3177;
// Bind all interfaces. Binding loopback inside a container makes the app
// invisible to the platform's healthcheck even though it "started fine".
const hostname = "0.0.0.0";
if (import.meta.main) console.log(
  `filtrsoft  ${hostname}:${port}  engine ${ENGINE_VERSION}  ` +
  `${hasBuild ? "serving web/dist" : "api only (dev)"}  db=${DB_PATH}`,
);
export default { port, hostname, fetch: app.fetch, idleTimeout: 120 };
