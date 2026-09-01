import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseModel } from "../src/catalog/derive.ts";
import { extractAttributes, fullestVariant } from "../src/catalog/match.ts";
import { parseOfferUpDetail, offerUpDescription } from "../src/sources/marketplace.ts";
import { namedCatalogBrand } from "../src/catalog/match.ts";
import { isUnsupportedPrinter, resolveCategory, resolveProductType } from "../src/signals/product-type.ts";
import type { ProductKind } from "../src/signals/product-type.ts";
import { detectCategory, offPlatformDomain, randomSuffix } from "../src/signals/index.ts";
import { variantPattern } from "../src/signals/variants.ts";
import {
  compMatchesQuery,
  findCondition,
  parseMoney,
  parseSoldDate,
  parseSoldRow,
  parseShipping,
} from "../src/sources/ebay.ts";
import {
  bestPhotos, cardToListing, parseCards, photoArea, photoIdentity, probeVerdict,
} from "../src/sources/marketplace.ts";
import sharp from "sharp";
import { thumbFromBytes, THUMB_EDGE, MAX_BYTES, THUMB_KEEP_DAYS } from "../src/photos/thumb.ts";
import { visionSignals } from "../src/vision/merge.ts";
import { buildQuestions } from "../src/verdict/questions.ts";
import {
  applyDiscovery, applyQuality, matchesSearch, NO_FILTERS, parseDrive, parseFilters,
  QUALITIES, segmentCounts, sortFeed, withinPrice,
  newSegmentCounts, parseSeen,
} from "../src/api/query.ts";
import { analyze } from "../src/signals/index.ts";
import { matchSku } from "../src/catalog/match.ts";
import { buildVerdict } from "../src/verdict/index.ts";
import { BY_SIGNAL, BY_FIELD, FALLBACK } from "../src/verdict/questions.ts";
import { parseBestBuy, parseMicroCenter, parseNewegg } from "../src/sources/retail.ts";
import { normalizeCondition } from "../src/valuation/condition.ts";
import { storageOf } from "../src/valuation/index.ts";
import { upsertListingFacts } from "../src/db/listings.ts";
import { storeVerdictWithDb } from "../src/db/verdicts.ts";
import {
  reserveVisionBudgetWithDb,
  settleVisionBudgetWithDb,
  spentVisionMicrosWithDb,
  visionReservationMicros,
} from "../src/vision/budget.ts";
import { evaluateRisk, riskGate, inPersonConditions } from "../src/verdict/risk-gates.ts";

describe("hard-blocker gate", () => {
  /**
   * An IN-PERSON check rides along as a condition; it does not veto BUY.
   *
   * The opposite was briefly true and measured BUY = 0 across all 976 listings,
   * with every VERIFY blocked by this exact check and none by a remote one.
   * DISPLAY_OUTPUTS is the anti-mining test — you cannot answer it from a
   * listing — so vetoing on it means no graphics card is ever a BUY at any
   * price, and activation lock does the same to every phone.
   */
  test("an in-person GPU check conditions a BUY rather than vetoing it", () => {
    const gate = riskGate(evaluateRisk("gpu", "NVIDIA RTX 4090 Founders Edition", null));
    expect(gate.ceiling).toBe("BUY");
    expect(gate.inPerson.map((c) => c.code)).toContain("DISPLAY_OUTPUTS");
    // ...and it must still be surfaced, or the condition is silently dropped.
    expect(inPersonConditions(gate).length).toBeGreaterThan(0);
  });

  test("a REMOTE unresolved blocker does veto BUY", () => {
    // IMEI/financing/carrier lock are all answerable by asking, so there is no
    // excuse for driving without the answer.
    const gate = riskGate(evaluateRisk("phone", "iPhone 15 128GB, great condition", null));
    expect(gate.ceiling).toBe("VERIFY");
    expect(gate.unresolved.every((c) => c.remote)).toBe(true);
  });

  test("allows BUY only when the GPU blocker is visibly resolved", () => {
    const gate = riskGate(evaluateRisk("gpu", "RTX 4090 with HDMI and DisplayPort outputs", null));
    expect(gate.ceiling).toBe("BUY");
  });

  test("applies Apple lock and MDM checks to desktops as well as laptops", () => {
    const checks = evaluateRisk("prebuilt", "2019 5K A2115 27 Inch iMac", null);
    expect(checks.map((c) => c.code)).toEqual(["ACTIVATION_LOCK", "EFI_MDM"]);
    // EFI_MDM is REMOTE, so this one legitimately caps at VERIFY.
    expect(riskGate(checks).ceiling).toBe("VERIFY");
  });

  test("a disclosed category blocker forces RISK", () => {
    const gate = riskGate(evaluateRisk("phone", "iPhone is iCloud locked for parts", null));
    expect(gate.ceiling).toBe("RISK");
    expect(gate.failed.map((c) => c.code)).toContain("ACTIVATION_LOCK");
  });
});

describe("vision budget ledger", () => {
  function budgetDb() {
    const d = new Database(":memory:");
    d.run(`CREATE TABLE vision_spend (
      id INTEGER PRIMARY KEY, reserved_micros INTEGER NOT NULL,
      actual_micros INTEGER, created_at TEXT NOT NULL, settled_at TEXT
    )`);
    d.run(`CREATE TABLE vision_results (
      id INTEGER PRIMARY KEY, cost_micros INTEGER NOT NULL DEFAULT 0,
      budget_reservation_id INTEGER, created_at TEXT NOT NULL
    )`);
    return d;
  }

  test("atomically refuses reservations beyond the daily cap", () => {
    const d = budgetDb();
    const at = "2026-08-27T12:00:00.000Z";
    d.run(
      `INSERT INTO vision_results (cost_micros, created_at) VALUES (?,?)`,
      [100_000, at],
    );

    const first = reserveVisionBudgetWithDb(d, 300_000, 500_000, at);
    expect(first).toBeNumber();
    expect(reserveVisionBudgetWithDb(d, 300_000, 500_000, at)).toBeNull();
    expect(spentVisionMicrosWithDb(d, at)).toBe(400_000);

    // Settling releases the unused maximum, so useful work can continue.
    settleVisionBudgetWithDb(d, first!, 10_000, at);
    expect(spentVisionMicrosWithDb(d, at)).toBe(110_000);
    expect(reserveVisionBudgetWithDb(d, 300_000, 500_000, at)).toBeNumber();
    d.close();
  });

  test("does not count a linked result and its ledger row twice", () => {
    const d = budgetDb();
    const at = "2026-08-27T12:00:00.000Z";
    const id = reserveVisionBudgetWithDb(d, visionReservationMicros(10), 2_000_000, at)!;
    settleVisionBudgetWithDb(d, id, 3_100, at);
    d.run(
      `INSERT INTO vision_results (cost_micros, budget_reservation_id, created_at)
       VALUES (?,?,?)`,
      [3_100, id, at],
    );
    expect(spentVisionMicrosWithDb(d, at)).toBe(3_100);
    d.close();
  });
});

/**
 * The self-hosted thumbnail.
 *
 * ⚠ THE POINT OF THESE IS THE BOUND, NOT THE FEATURE. Putting images on the
 * production volume is what filled it in 2026-08 and took the crawler down for
 * 13 hours — 316 MB of full-resolution photos for 654 listings. This cache is
 * safe only because one image per listing at 480px WebP is ~15 KB, so that is
 * the number under test. Read `photos/thumb.ts` before changing any of it.
 */
/**
 * A photo of a spec readout is evidence FOR the seller.
 *
 * ⚠ THIS IS YISH'S DOMAIN KNOWLEDGE AND IT OVERRODE THE ENGINE. 2026-08-31, on
 * an RTX 5090 FE at $2,800 the feed surfaced 30 minutes after it posted:
 * *"the image itself is a photo of the computer's specs verified on the monitor
 * of the PC, making this extra trustworthy, not a red flag ... a lot of the time
 * there is a screenshot or an image of proof of specs which usually states the
 * model or type of ram, cpu, gpu."*
 *
 * The engine disagreed with itself. The vision prompt calls a spec screen "the
 * highest-value image in any listing", `photos/index.ts` records the Phase 0
 * miss where a whole spec sheet sat in photo 3 — and `screenshotArtifacts`
 * asked for "any UI chrome proving the photo was screenshotted from another
 * app", which a photo of Task Manager is covered in. So it fired at HIGH
 * severity on exactly the listings a diligent seller produces.
 */
/**
 * The fullest spelling of a model, not the first one seen.
 *
 * Yish, 2026-08-31, on a Craigslist build the engine refused to price:
 * *"the description gives all the exact components so I don't know how it
 * failed."* The title read "... RTX 5080 / Ryzen 7 9800X" and the description
 * "AMD Ryzen 7 9800X3D". `.match()` returns the FIRST hit and the title comes
 * first, so the engine recorded a chip that does not exist, found no SKU, and
 * dropped the build to 0.42 coverage -- under the gate that stops a whole
 * machine being priced off one component.
 */
/**
 * OfferUp item pages carry a description and a spec table. We were reading
 * neither.
 *
 * ⚠ **OFFERUP AND MERCARI HAD 0% DESCRIPTION COVERAGE — 161 LIVE LISTINGS WITH
 * NOTHING BUT A TITLE**, measured 2026-08-31 against 1% for Craigslist. A
 * search CARD has no description and nothing ever opened the item page for
 * text, so "Can't be valued: gpu and cpu not stated" was true of the title and
 * false of the listing. `ou:photos` was already visiting every one of those
 * pages for the gallery.
 *
 * The text below was CAPTURED off a real listing, not invented.
 */
describe("offerup detail text", () => {
  /**
   * Captured off a real OfferUp item page. Held as LINES rather than one
   * escaped literal so the fixture reads the way the page does, and so no
   * `\n` can be lost the next time this file is edited through a shell.
   */
  const PAGE = [
    "$100", "", "$110", "macbook air", "",
    "Last updated 14 days ago in Acton, MA", "",
    "Description", "", "works well lightly used no issues", "",
    "Details", "",
    "Condition", "", "Used (normal wear)", "",
    "Screen Size", "", "13-13.9 in", "",
    "Model", "", "macbook air", "",
    "Type", "", "Notebook/Laptop", "",
    "Additional details", "", "RAM Size", "", "1-19 GB", "",
    "Skip Advertisement", "Item location map",
  ].join("\n");

  test("the description and the spec table both come out", () => {
    const d = parseOfferUpDetail(PAGE);
    expect(d.description).toBe("works well lightly used no issues");
    expect(d.details["screen size"]).toBe("13-13.9 in");
    expect(d.details["model"]).toBe("macbook air");
    expect(d.details["type"]).toBe("Notebook/Laptop");
  });

  /**
   * ⚠ THE TABLE IS FLATTENED INTO TEXT ON PURPOSE. `extractAttributes` and the
   * signal layer read free text, so structured data has to be written back as
   * "key: value" lines to reach them at all.
   */
  test("the stored description carries the specs, minus the condition chip", () => {
    const out = offerUpDescription(parseOfferUpDetail(PAGE));
    expect(out).toContain("works well lightly used no issues");
    expect(out).toContain("model: macbook air");
    // `condition` is already a first-class signal; repeating it as prose would
    // give the text layer a second, weaker copy to disagree with.
    expect(out).not.toContain("condition:");
  });

  test("a page with no description yields nothing rather than guessing", () => {
    expect(parseOfferUpDetail("").description).toBe("");
    expect(parseOfferUpDetail(["Home", "Electronics", "Sold by", "Rushi"].join("\n")).description).toBe("");
    expect(offerUpDescription({ description: "", details: {} })).toBe("");
  });

  test("the table stops at the end of the table", () => {
    const d = parseOfferUpDetail(PAGE);
    // "Related searches" and everything past the boundary must not become specs.
    expect(Object.keys(d.details)).not.toContain("skip advertisement");
    expect(Object.keys(d.details)).not.toContain("item location map");
  });
});

describe("variant suffixes survive a truncated title", () => {
  const cpu = (s: string) => extractAttributes(s).cpu ?? null;
  const gpu = (s: string) => extractAttributes(s).gpu ?? null;

  test("the description's X3D beats the title's truncation", () => {
    expect(cpu("Gaming PC - RTX 5080 / Ryzen 7 9800X  CPU: AMD Ryzen 7 9800X3D (8-core)"))
      .toBe("ryzen 7 9800x3d");
  });

  /**
   * HANDOFF §5: *"KNOWN LIMITATION: 'RTX 3080 Ti' passes an `rtx 3080` query."*
   * The Ti is materially more valuable, so reading one as the other is a
   * confident wrong number rather than no number.
   */
  test("the Ti is not dropped when the title omits it", () => {
    expect(gpu("Gaming PC RTX 3080 build  GPU: RTX 3080 Ti 12GB")).toBe("rtx 3080 ti");
    expect(gpu("RTX 4070 Super gaming pc")).toBe("rtx 4070 super");
  });

  /**
   * ⚠ THE SAFETY RULE. A listing can name two different chips, and "longest
   * string anywhere" would pick whichever happened to have more characters.
   * The FIRST match decides which product this is; later mentions may only
   * lengthen THAT one.
   */
  test("two different chips: the first still wins", () => {
    expect(cpu("upgraded from an i5-9400 to an i7-12700K")).toBe("i5-9400");
    expect(cpu("i7-12700 build, actually an i7-12700KF")).toBe("i7-12700kf");
  });

  test("nothing to lengthen is left exactly as it was", () => {
    expect(cpu("Ryzen 7 7800X3D gaming pc")).toBe("ryzen 7 7800x3d");
    expect(cpu("no processor mentioned here")).toBeNull();
    expect(gpu("no card mentioned here")).toBeNull();
  });

  test("fullestVariant keeps the first base and only lengthens it", () => {
    const B = /^(?:rtx|gtx|rx)\s?\d{3,4}/;
    expect(fullestVariant([], B)).toBe("");
    expect(fullestVariant(["rtx 3080", "rtx 3080 ti"], B)).toBe("rtx 3080 ti");
    // A different base is ignored entirely, however long it is.
    expect(fullestVariant(["rtx 3080", "rtx 4090 super"], B)).toBe("rtx 3080");
  });
});

describe("a spec screen is proof, not a scam tell", () => {
  const V = (over: Record<string, unknown> = {}) => ({
    components: {}, facts: [], specScreens: [], lockScreen: false,
    bootScreenOnly: false, screenshotArtifacts: null, displayOutputsVisible: null,
    portCondition: null, portDamage: false, physicalDamage: [], unreadable: [],
    ...over,
  } as any);

  test("spec screens produce a POSITIVE signal", () => {
    const out = visionSignals(V({ specScreens: ["2"] }));
    const proof = out.find((s) => s.code === "SPEC_SCREEN_PROOF");
    expect(proof).toBeTruthy();
    expect(proof!.polarity).toBe("positive");
    // Info, not high. It is reassurance, not an alarm.
    expect(proof!.severity).toBe("info");
    expect(proof!.evidence).toContain("shown rather than claimed");
  });

  test("no spec screen, no positive signal invented", () => {
    expect(visionSignals(V()).some((s) => s.code === "SPEC_SCREEN_PROOF")).toBe(false);
  });

  /**
   * ⚠ THE DOWNGRADE IS FOR THE CACHE, NOT THE MODEL. Vision results are cached
   * on photo content, so every row stored before PROMPT_VERSION 2026-08-31.1
   * came from the prompt that conflated the two. Those keep serving until a
   * listing is re-analysed, and without this a re-score would go on calling a
   * proven machine a scam using an answer from a prompt that no longer exists.
   */
  test("a stale artifact report is demoted when a spec screen is present", () => {
    const withSpec = visionSignals(V({
      specScreens: ["2"], screenshotArtifacts: "Image 2 shows window chrome",
    })).find((s) => s.code === "SCREENSHOT_ARTIFACTS")!;
    expect(withSpec.severity).toBe("medium");
    expect(withSpec.evidence).toContain("window chrome around one of those is normal");

    // And it is a DOWNGRADE, not a suppression: a seller can post a genuine
    // spec screen AND a lifted product photo.
    expect(withSpec.polarity).toBe("negative");
  });

  test("without a spec screen it stays a high-severity tell", () => {
    const alone = visionSignals(V({
      screenshotArtifacts: "SAVE icon visible over the product photo",
    })).find((s) => s.code === "SCREENSHOT_ARTIFACTS")!;
    expect(alone.severity).toBe("high");
    expect(alone.evidence).toContain("screenshots taken from another app");
  });

  test("every vision signal carries its own polarity", () => {
    // `engine/index.ts` used to push these with a hardcoded negative, which made
    // a positive finding structurally impossible to express.
    for (const s of visionSignals(V({ specScreens: ["1"], bootScreenOnly: true, physicalDamage: ["dent"] }))) {
      expect(["positive", "negative"]).toContain(s.polarity);
    }
    expect(visionSignals(V({ bootScreenOnly: true }))[0].polarity).toBe("negative");
  });

  test("a positive signal never earns a question", () => {
    const ask = (sig: Array<{ code: string; polarity: string }>) => buildQuestions(
      { signals: sig, missingValueFields: [], category: "gpu" } as any,
      {} as any,
    );
    // The negative case still asks — this is the real scam tell.
    expect(ask([{ code: "SCREENSHOT_ARTIFACTS", polarity: "negative" }])[0])
      .toContain("photos you've taken yourself");

    /**
     * The positive case must not. It still gets the CATEGORY fallback, which is
     * right — every listing deserves something to ask — so the assertion is
     * that the doubt-resolving question is absent, not that the list is empty.
     * Asking "send photos you've taken yourself" of someone who already posted
     * a spec readout tells him his proof does not count.
     */
    const positive = ask([{ code: "SPEC_SCREEN_PROOF", polarity: "positive" }]);
    expect(positive.some((q) => q.includes("photos you've taken yourself"))).toBe(false);

    /**
     * And the same code on the SAME listing behaves differently by polarity,
     * which is the whole reason the guard is on polarity rather than on the
     * `BY_SIGNAL` table.
     */
    const both = ask([
      { code: "SPEC_SCREEN_PROOF", polarity: "positive" },
      { code: "BOOT_SCREEN_ONLY", polarity: "negative" },
    ]);
    expect(both[0]).toContain("home screen");
  });
});

describe("thumbnail bounds", () => {
  /** A real image, encoded here rather than checked in as a fixture. */
  const bigJpeg = async () =>
    sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .jpeg({ quality: 90 }).toBuffer();

  test("a 2400px photo becomes a 480px WebP well under the ceiling", async () => {
    const t = await thumbFromBytes(await bigJpeg());
    expect(t).not.toBeNull();
    expect(t!.mime).toBe("image/webp");
    expect(Math.max(t!.width, t!.height)).toBe(THUMB_EDGE);
    expect(t!.bytes.length).toBeLessThan(MAX_BYTES);
    // The whole justification: ~20 KB against the ~480 KB originals that filled
    // the volume. A generous assertion, because a photograph compresses worse
    // than this flat fill — `bun run thumbs` measured 15 KB across 40 real ones.
    expect(t!.bytes.length).toBeLessThan(60_000);
  });

  test("a small photo is not blown up", async () => {
    const small = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .png().toBuffer();
    const t = await thumbFromBytes(small);
    expect(t!.width).toBe(120);
    expect(t!.height).toBe(90);
  });

  test("something that is not an image yields null, not a crash", async () => {
    expect(await thumbFromBytes(Buffer.from("<html>404 Not Found</html>"))).toBeNull();
    expect(await thumbFromBytes(Buffer.alloc(0))).toBeNull();
  });

  /**
   * ⚠ THE PRUNE WINDOW MUST MATCH THE FEED'S. `/v1/feed` excludes anything
   * posted more than 28 days ago, so a thumb older than that can never be
   * rendered and is pure cost on the volume. These two numbers drifting apart
   * is how the cache would quietly stop being bounded by the feed.
   */
  test("the prune window matches what the feed will show", () => {
    const api = readFileSync(new URL("../src/api/index.ts", import.meta.url), "utf8");
    expect(api).toContain(`date('now', '-${THUMB_KEEP_DAYS} days')`);
  });
});

describe("listing fact persistence", () => {
  test("preserves first capture and records a pushed price drop once", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE listings (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      asking_price_cents INTEGER,
      location TEXT,
      posted_at TEXT,
      updated_at TEXT,
      captured_at TEXT NOT NULL,
      photo_count INTEGER,
      seller_ref TEXT,
      raw_json TEXT,
      last_seen TEXT,
      last_price_cents INTEGER,
      delisted_at TEXT,
      delist_reason TEXT,
      UNIQUE(source, source_id)
    )`);
    db.run(`CREATE TABLE listing_prices (
      id INTEGER PRIMARY KEY,
      listing_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      observed_at TEXT NOT NULL
    )`);
    const base = {
      source: "facebook",
      sourceId: "abc",
      url: "https://example.test/abc",
      title: "RTX 4090",
      description: "original",
      askingPriceCents: 180000,
      location: "Newton, MA",
      postedAt: "2026-08-25T00:00:00.000Z",
      photoCount: 2,
      sellerRef: "seller-1",
      raw: { pass: 1 },
    };
    const first = upsertListingFacts(db, base, "2026-08-26T00:00:00.000Z");
    expect(first.inserted).toBe(true);

    const updated = {
      ...base,
      title: "RTX 4090 Founders Edition",
      description: "updated",
      askingPriceCents: 150000,
      photoCount: 3,
      raw: { pass: 2 },
    };
    const second = upsertListingFacts(db, updated, "2026-08-27T00:00:00.000Z");
    expect(second).toEqual({ id: first.id, inserted: false });
    // A repeated observation at the same price is not another history event.
    upsertListingFacts(db, updated, "2026-08-27T01:00:00.000Z");

    expect(db.query(`SELECT title, description, asking_price_cents, captured_at,
      photo_count, last_price_cents FROM listings`).get()).toEqual({
      title: "RTX 4090 Founders Edition",
      description: "updated",
      asking_price_cents: 150000,
      captured_at: "2026-08-26T00:00:00.000Z",
      photo_count: 3,
      last_price_cents: 150000,
    });
    expect(db.query("SELECT price_cents FROM listing_prices ORDER BY id").all()).toEqual([
      { price_cents: 180000 },
      { price_cents: 150000 },
    ]);
    db.close();
  });

  test("normalises a parsed zero to no price", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE listings (
      id INTEGER PRIMARY KEY, source TEXT, source_id TEXT, url TEXT, title TEXT,
      description TEXT, asking_price_cents INTEGER, location TEXT, posted_at TEXT,
      updated_at TEXT, captured_at TEXT, photo_count INTEGER, seller_ref TEXT,
      raw_json TEXT, last_seen TEXT, last_price_cents INTEGER, delisted_at TEXT,
      delist_reason TEXT, UNIQUE(source, source_id)
    )`);
    db.run(`CREATE TABLE listing_prices (
      id INTEGER PRIMARY KEY, listing_id INTEGER, price_cents INTEGER, observed_at TEXT
    )`);
    upsertListingFacts(db, {
      source: "craigslist", sourceId: "zero", url: "https://example.test/zero",
      title: "No price", description: "", askingPriceCents: 0, location: null,
      postedAt: null, photoCount: 0,
    }, "2026-08-27T00:00:00.000Z");
    expect(db.query("SELECT asking_price_cents,last_price_cents FROM listings").get()).toEqual({
      asking_price_cents: null,
      last_price_cents: null,
    });
    expect(db.query("SELECT COUNT(*) n FROM listing_prices").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("verdict retention", () => {
  test("refreshes an unchanged answer and appends only a real transition", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE verdicts (
      id INTEGER PRIMARY KEY,
      listing_id INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      call TEXT NOT NULL,
      confidence TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    const first = { call: "PASS", confidence: "high", headline: "Overpriced." };
    expect(storeVerdictWithDb(db, 1, "0.1.0", first, "2026-08-27T00:00:00.000Z")).toMatchObject({
      inserted: true,
      refreshed: false,
    });
    expect(storeVerdictWithDb(db, 1, "0.1.1", first, "2026-08-27T01:00:00.000Z")).toMatchObject({
      inserted: false,
      refreshed: true,
    });
    expect(db.query("SELECT COUNT(*) n FROM verdicts").get()).toEqual({ n: 1 });
    expect(db.query("SELECT engine_version FROM verdicts").get()).toEqual({ engine_version: "0.1.1" });

    const changed = { ...first, headline: "Price dropped, but still overpriced." };
    expect(storeVerdictWithDb(db, 1, "0.1.1", changed, "2026-08-27T02:00:00.000Z")).toMatchObject({
      inserted: true,
      refreshed: false,
    });
    expect(db.query("SELECT COUNT(*) n FROM verdicts").get()).toEqual({ n: 2 });
    db.close();
  });
});

describe("product grammar", () => {
  // Typed explicitly: `test.each` infers the tuple as a union of its literals,
  // so `kind` arrives as `string` and no longer matches `ProductKind`.
  const CASES: Array<[string, ProductKind, string | null]> = [
    ["Dell Precision 5760 + Charger", "tech", "laptop"],
    ["HP XL 17 Laptop Bag", "accessory", "laptop"],
    ["Lenovo P50 Mobile Workstation Laptop", "tech", "laptop"],
    ["Apple iMac A1312 with keyboard and mouse", "tech", "prebuilt"],
    ["Glass and Metal Computer Table", "furniture", null],
  ];
  test.each(CASES)("classifies %s", (title, kind, category) => {
    expect(resolveProductType(title).kind).toBe(kind);
    expect(resolveCategory(title)).toBe(category);
  });

  test("does not let a trailing component retype a whole laptop", () => {
    expect(resolveCategory("HP EliteBook 840 Laptop i5 8GB RAM 256GB SSD")).toBe("laptop");
  });

  test("keeps plural laptops ahead of their embedded GPU", () => {
    const title = "Dell 9520 Windows 11 Pro Laptops. 14-Core, i9, Nvidia GPU";
    expect(detectCategory(title)).toBe("laptop");
  });

  test("does not let a whole desktop fall through to its CPU category", () => {
    expect(detectCategory("Dell OptiPlex 5070 SFF i7-9700 16GB 512GB")).toBe("prebuilt");
    expect(detectCategory("HP EliteOne 800 G4 AIO Desktop i5-8500")).toBe("prebuilt");
    expect(detectCategory("HP Envy TE01-1022 Desktop i7-10700")).toBe("prebuilt");
  });

  test("keeps printers out even when their product line sounds like a laptop", () => {
    const title = "PRINTER HP ENVY 6055E Wireless All In One";
    expect(isUnsupportedPrinter(title)).toBeTrue();
    expect(detectCategory(title)).toBe("unknown");
  });

  test("recognises Apple towers but not replacement MacBook batteries", () => {
    expect(resolveProductType("Mac Pro 2012 upgraded").kind).toBe("tech");
    expect(resolveCategory("Mac Pro 2012 upgraded")).toBe("prebuilt");
    expect(resolveProductType("Newertech MacBook battery 2017").kind).toBe("accessory");
  });

  test("treats a bare CPU generation as evidence of a computer", () => {
    expect(resolveProductType("HP Touch screen i5 10th generation").kind).toBe("tech");
    expect(resolveProductType("HP Touch screeni5 10th generation").kind).toBe("tech");
  });

  test("does not cross a seller-stated brand during catalog matching", () => {
    const brands = ["Apple", "Dell", "Microsoft"];
    expect(namedCatalogBrand("Dell 14-Core Pro Laptop with Microsoft Office", brands)).toBe("Dell");
    expect(namedCatalogBrand("MacBook Pro 14", brands)).toBeNull();
    expect(namedCatalogBrand("ThinkPad X1 with Microsoft Office", brands)).toBeNull();
  });
});

describe("generative catalog parser", () => {
  test.each([
    ["Dell Latitude 7420 i7 32GB", "laptop", "Dell", "Latitude 7420"],
    ["HP EliteBook 840 G6 Laptop", "laptop", "HP", "EliteBook 840 G6"],
    ["Lenovo ThinkPad T14s Gen 2", "laptop", "Lenovo", "ThinkPad T14S"],
    ["ASUS RTX 4070 Ti GPU", "gpu", "NVIDIA", "RTX 4070 TI"],
    ["Apple iMac A1312 27 inch", "prebuilt", "Apple", "iMac A1312"],
  ])("derives %s", (title, category, brand, model) => {
    expect(parseModel(title, category)).toMatchObject({ category, brand, model });
  });

  test.each([
    "Dell laptop 15.6 inch 2024",
    "Spring Laptop Blowout Sale!",
    "24 laptops for sale starting at $30",
  ])("refuses an unsafe catalog row from %s", (title) => {
    expect(parseModel(title, resolveCategory(title))).toBeNull();
  });
});

describe("eBay sold parser", () => {
  test("parses money and keeps free shipping distinct from unknown shipping", () => {
    expect(parseMoney("US $1,234.56 to $1,400.00")).toBe(123456);
    expect(parseShipping(["Free shipping"])).toBe(0);
    expect(parseShipping(["No delivery details"])).toBeNull();
  });

  test("assigns the current year to a sold date that omits it", () => {
    const now = Date.parse("2026-08-27T12:00:00Z");
    expect(parseSoldDate(["Sold Aug 20"], now)).toBe("2026-08-20T00:00:00.000Z");
    expect(parseSoldDate(["Sold Dec 20"], now)).toBe("2025-12-20T00:00:00.000Z");
  });

  test("does not read NEW LISTING as the item's condition", () => {
    expect(findCondition(["NEW LISTINGApple iPhone 15", "Used · Apple iPhone 15"])).toBe("Used");
    expect(normalizeCondition("for_parts")).toBe("for_parts");
  });

  test("prefers the anchor title over seller feedback", () => {
    expect(parseSoldRow({
      href: "https://www.ebay.com/itm/123456789012",
      title: "Apple iPhone 15 128GB Unlocked",
      text: ["tspence007 100% positive (41)", "$499.00", "Free shipping", "Used", "Sold Aug 20"],
      img: null,
    }, Date.parse("2026-08-27T12:00:00Z"))).toMatchObject({
      sourceItemId: "123456789012",
      title: "Apple iPhone 15 128GB Unlocked",
      soldPriceCents: 49900,
      shippingCents: 0,
      conditionNorm: "used",
    });
  });

  test("rejects a materially different variant", () => {
    expect(compMatchesQuery("ASUS RTX 3080 Ti Graphics Card", "NVIDIA RTX 3080 graphics card", "gpu")).toEqual({
      ok: false,
      why: 'title is the "ti" variant, which the query did not ask for',
    });
    expect("RTX 4070 Super".match(variantPattern("gpu"))).toContain("Super");
  });
});

describe("attribute parsing", () => {
  test.each([
    ["Dell XPS 16GB RAM 512GB SSD", 512],
    ["MacBook Air M3 8GB 256GB SSD", 256],
    ["Gaming PC 32GB DDR5 1TB NVMe", 1024],
    ["Samsung Galaxy S24 Ultra 256G unlocked", 256],
    ["Laptop with 32GB RAM", null],
  ])("extracts storage from %s", (title, storage) => {
    expect(storageOf(title)).toBe(storage);
  });
});

describe("marketplace card parser", () => {
  test("uses the final OfferUp path segment and pipe-delimited fields", () => {
    expect(parseCards("offerup", [{
      href: "/item/detail/4dd3eb84-ef77-41e5-a210-123456789abc",
      text: "White Custom Gaming PC Build | $1,400 | Salem, MA | Local pickup",
    }])).toEqual([expect.objectContaining({
      sourceId: "4dd3eb84-ef77-41e5-a210-123456789abc",
      title: "White Custom Gaming PC Build",
      priceCents: 140000,
      location: "Salem, MA",
      shipped: false,
    })]);
  });
});

describe("captured retail fixtures", () => {
  const fixture = (name: string): string[] => {
    const data = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "docs", "testset", `${name}-lines.json`), "utf8"),
    ) as string[] | Record<string, string[]>;
    return Array.isArray(data) ? data : Object.values(data).flat();
  };

  test("Best Buy fixture keeps financing-only phones at zero and unavailable", () => {
    const offers = parseBestBuy(fixture("bestbuy"));
    expect(offers).toHaveLength(194);
    expect(offers.find((o) => o.title.includes("iPhone 15 128GB - Blue (Verizon)"))).toMatchObject({
      priceCents: 0,
      financedOnly: true,
      available: false,
    });
  });

  test("Newegg fixture takes the current card price", () => {
    const offers = parseNewegg(fixture("newegg"));
    expect(offers).toHaveLength(188);
    expect(offers.find((o) => o.title.includes("GV-N5070WF3OC-12GD"))?.priceCents).toBe(79999);
  });

  test("Micro Center fixture keeps Cambridge stock and current price", () => {
    const offers = parseMicroCenter(fixture("microcenter"));
    expect(offers).toHaveLength(117);
    expect(offers.find((o) => o.title.includes("RTX 5090 Gaming OC"))).toMatchObject({
      priceCents: 439999,
      stockCount: 9,
      available: true,
    });
  });
});

/**
 * The off-platform redirect scam. Yish confirmed these live on 2026-08-28 by
 * messaging two listings the feed was recommending and being sent to an outside
 * "store" both times.
 *
 * Both directions are asserted. Precision matters more than recall here: a
 * false scam label kills a real deal AND teaches the reader to ignore the badge
 * on the day it is right.
 */
describe("scam: off-platform redirect", () => {
  test("catches the obfuscated domain from the real listings", () => {
    expect(offPlatformDomain("More photos here: www.ww5936.com Feel free to reach out")).toBe("ww5936.com");
    expect(offPlatformDomain("details are available here: https://smuybfq.com/products/m55223229104")).toBe("smuybfq.com");
  });

  /**
   * REGRESSION: a negative lookahead cannot express this. `(?:www\.)?` is
   * optional, so when the lookahead rejects "craigslist" the engine backtracks,
   * declines to consume `www.`, and re-tests against "www" — which is not on
   * the exclusion list. Both of these matched as off-platform links.
   */
  test("a known domain behind www. is NOT off-platform", () => {
    expect(offPlatformDomain("see https://www.craigslist.org/view/d/abc")).toBeNull();
    expect(offPlatformDomain("www.amazon.com")).toBeNull();
    expect(offPlatformDomain("https://www.ebay.com/itm/123")).toBeNull();
  });

  test("a helpful build list is not fraud", () => {
    expect(offPlatformDomain("full specs at https://pcpartpicker.com/list/xyz")).toBeNull();
    expect(offPlatformDomain("benchmarks: https://www.techpowerup.com/gpu")).toBeNull();
  });

  /**
   * The SECOND scam Yish confirmed used a different trick: a phone number
   * written to defeat the contact filter, in a $240 listing for an i9-14900K +
   * RTX 4070 Ti build.
   */
  test("obfuscated phone numbers are caught, real ones are not", async () => {
    const { analyze } = await import("../src/signals/index.ts");
    const mk = (description: string) => ({
      source: "facebook", sourceId: "x", url: "", title: "Custom Built Gaming PC",
      description, askingPriceCents: 24000, location: null, postedAt: null,
      updatedAt: null, photoUrls: [], attributes: {}, raw: null,
    });
    const fired = (d: string) =>
      analyze(mk(d) as never).signals.some((x) => x.code === "OFF_PLATFORM_REDIRECT");

    expect(fired("great condition (414^^998^^9114) text me")).toBe(true);
    expect(fired("call 617__555__0134 anytime")).toBe(true);
    // How people actually write a phone number. Flagging these makes the
    // signal useless, so they must never fire.
    expect(fired("text me at (617) 555-0134")).toBe(false);
    expect(fired("call 617-555-0134")).toBe(false);
    expect(fired("617.555.0134 is my cell")).toBe(false);
  });

  test("generated title suffix: letters convict, model numbers do not", () => {
    expect(randomSuffix("MacBook Pro M1 Max 16in 32GB 1TB Space Gray UPZT")).toBe(true);
    expect(randomSuffix("Apple MacBook Pro A2141 16in 1TB SSD G7FQ")).toBe(true);
    // Real model numbers and real words must never trip it.
    expect(randomSuffix("Asus motherboard dark hero X570")).toBe(false);
    expect(randomSuffix("Dell Laptop Xps 13 9310")).toBe(false);
    expect(randomSuffix("MacBook Pro M4 Pro 14” 2024")).toBe(false);
    expect(randomSuffix("Gigabyte Nvidia GTX 1060 3GB DDR5")).toBe(false);
    expect(randomSuffix("Gaming pc 3070 ti - NEED GONE ASAP LEAVING FOR COLLEGE THIS WEEK")).toBe(false);
  });
});

/**
 * ZERO_PHOTOS fired on ALL 87 OfferUp and ALL 10 Mercari listings, because
 * `cardToListing` hardcoded `photoUrls: []` and the worker never read the
 * `<img>` inside each card anchor. The flag's own text calls itself "close to
 * dispositive on its own", so the engine was condemning listings that had
 * pictures. Yish found it on "RTX 3060 12GB Graphics Card - Tested and Working".
 */
describe("marketplace card photos", () => {
  test("a card thumbnail reaches the listing", () => {
    const [card] = parseCards("offerup", [{
      href: "/item/detail/a2e9980a-c1b5-35fe-9b55-ae0840ce2e53",
      text: "RTX 3060 12GB Graphics Card- Tested and Working | $210 | Boston, MA",
      photo: "https://pics.offerup.com/x/abc_400x400.jpg",
    }]);
    expect(card.photoUrl).toBe("https://pics.offerup.com/x/abc_400x400.jpg");
    expect(cardToListing(card).photoUrls).toEqual(["https://pics.offerup.com/x/abc_400x400.jpg"]);
  });

  test("a card with no image yields no photos, not a fake one", () => {
    const [card] = parseCards("offerup", [{
      href: "/item/detail/b1234567-c1b5-35fe-9b55-ae0840ce2e53",
      text: "Custom Gaming PC Build | $500 | Salem, MA",
    }]);
    expect(cardToListing(card).photoUrls).toEqual([]);
  });
});

/**
 * OfferUp detail-page photos.
 *
 * Yish, 2026-08-31: *"OfferUp listings only show 1 photo in worse resolution
 * than the original, when the original listing has like 4 photos it will only
 * show me the hero photo."*
 *
 * Every url below was CAPTURED off a real OfferUp listing by
 * `src/browser/ou-probe.mjs`, not invented. The shape is what matters: the same
 * photo appears three or four times per page at different sizes, each with its
 * OWN signature, so the filename is the only stable identity.
 */
describe("offerup detail photos", () => {
  // Listing 465f5561: four gallery slides, nine <img> tags.
  const REAL = [
    "https://images.offerup.com/xGB99GZMw60HspHCpMGE5H9Qs4Y=/1080x1080/888b/888bff8536434f2f8b6ef9732eb5a798.jpg",
    "https://images.offerup.com/pM071t1stGtdatAcZvcOp_AMdUM=/1080x1920/c326/c326fd9f9c9c4a139e433f6bfeded32b.jpg",
    "https://images.offerup.com/t-fmR80N0YxBT1huuP52ychwy-A=/1442x1922/950e/950ef870e9744a8e88f637a18d27585c.jpg",
    "https://images.offerup.com/mPl4bagMTWQeynHh4q286IcSUSI=/250x250/888b/888bff8536434f2f8b6ef9732eb5a798.jpg",
    "https://images.offerup.com/RM-dxQ76puUikKDi_dG2nWK8y4k=/250x444/c326/c326fd9f9c9c4a139e433f6bfeded32b.jpg",
    "https://images.offerup.com/6I6BDHW9bkKrMS5R2QLiiWOlz2U=/250x333/950e/950ef870e9744a8e88f637a18d27585c.jpg",
    "https://images.offerup.com/cF9bovo_WNoupxVdNm_azKTkgPU=/1080x1920/bcac/bcaca665269e40109add3b847a7f0c33.jpg",
    "https://images.offerup.com/pM071t1stGtdatAcZvcOp_AMdUM=/1080x1920/c326/c326fd9f9c9c4a139e433f6bfeded32b.jpg",
    "https://images.offerup.com/t-fmR80N0YxBT1huuP52ychwy-A=/1442x1922/950e/950ef870e9744a8e88f637a18d27585c.jpg",
  ];

  test("nine urls are four photos, each at its largest", () => {
    const best = bestPhotos(REAL);
    expect(best.length).toBe(4);
    // Identities, in first-appearance order -- the gallery's own order, which
    // is what makes photo 1 the hero on the card and in the feed.
    expect(best.map((u) => photoIdentity(u)!.slice(0, 4)))
      .toEqual(["888b", "c326", "950e", "bcac"]);
    // And every one of them is the big signed url, not the 250 it also has.
    for (const u of best) expect(photoArea(u)).toBeGreaterThanOrEqual(1080 * 1080);
  });

  test("the signature is per size, so identity cannot be the url", () => {
    // Same photo, three urls, two distinct signatures. Deduping on the url
    // gives nine photos where there are four.
    const one = REAL.filter((u) => u.includes("/c326"));
    expect(one.length).toBe(3);
    expect(new Set(one).size).toBe(2);
    expect(new Set(one.map(photoIdentity)).size).toBe(1);
  });

  /**
   * The size floor is a CONTAMINATION GUARD. A detail page also renders
   * "similar items" as images.offerup.com thumbnails, and letting those in
   * would give a listing ANOTHER listing's photos -- which vision then reads
   * specs off, producing a confident wrong verdict. Gallery slides are served
   * at 720 or larger, carousel thumbnails at 250.
   */
  test("card-sized thumbnails are not gallery slides", () => {
    const carousel = [
      "https://images.offerup.com/aaa=/250x250/1111/1111ff8536434f2f8b6ef9732eb5a798.jpg",
      "https://images.offerup.com/bbb=/100x100/2222/2222ff8536434f2f8b6ef9732eb5a798.jpg",
    ];
    expect(bestPhotos(carousel)).toEqual([]);
    // Mixed in with a real gallery, only the gallery survives.
    expect(bestPhotos([...carousel, ...REAL]).length).toBe(4);
  });

  test("720px slides pass, which is the smallest gallery seen in the wild", () => {
    // Listing e29c8b98 serves its five slides at 720x1280.
    const small = [
      "https://images.offerup.com/x=/720x1280/c1b0/c1b05ae517d14119b232ec829e280814.jpg",
      "https://images.offerup.com/y=/250x444/c1b0/c1b05ae517d14119b232ec829e280814.jpg",
    ];
    expect(bestPhotos(small)).toEqual([small[0]]);
  });

  test("non-image hosts and sizeless urls are ignored rather than guessed at", () => {
    expect(bestPhotos([
      // A video thumbnail. OfferUp cards can lead with one and it is not a
      // gallery photo -- real, from listing e29c8b98's card.
      "https://videos.offerup.com/1e5c/1e5c88fe403840b69456459ce5170e13/thumbnail/x_thumb_small.0000001.jpg",
      "https://images.offerup.com/z=/nosize/aaaa/aaaaff8536434f2f8b6ef9732eb5a798.jpg",
    ])).toEqual([]);
  });
});

/**
 * The delisting probe for browser-backed sources.
 *
 * ⚠ THE ASYMMETRY IS THE POINT. A false "gone" deletes a real deal from the
 * feed permanently and silently; a false "still up" costs one wasted tap. So
 * "gone" needs explicit evidence and "still up" needs POSITIVE evidence, and
 * everything else is `null` — no opinion, leave the row alone.
 */
describe("probeVerdict", () => {
  const FB_CHROME = " Number of unread notifications 20+ Marketplace Edit Marketplace Settings "
    + "Browse all Notifications Inbox Buying Selling Create new listing Location Newton, "
    + "Massachusetts Categories Vehicles Property Rentals Apparel Classifieds Electronics";

  test("explicit removal text is gone", () => {
    expect(probeVerdict({ text: "This listing isn't available " + FB_CHROME, finalUrl: "https://www.facebook.com/marketplace/item/1" })?.gone).toBe(true);
    expect(probeVerdict({ text: "We can't find that item. It may have been sold.", finalUrl: "https://offerup.com/item/detail/x" })?.gone).toBe(true);
  });

  test("a bounce to the site root is gone", () => {
    expect(probeVerdict({ text: "OfferUp Buy and sell locally near you today with great deals", finalUrl: "https://offerup.com/" })?.gone).toBe(true);
  });

  /**
   * REGRESSION: Facebook's item page is a SPA. Probing a listing returned only
   * nav chrome — no title, no price, no removal notice — and the first version
   * reported it STILL UP because nothing said otherwise. Confidently wrong.
   */
  test("a page we could not actually read gets no opinion", () => {
    expect(probeVerdict({ text: FB_CHROME, finalUrl: "https://www.facebook.com/marketplace/item/1" })).toBeNull();
    expect(probeVerdict({ text: "", finalUrl: "", error: "Timeout 45000ms exceeded" })).toBeNull();
    expect(probeVerdict({ text: "   ", finalUrl: "https://offerup.com/item/detail/x" })).toBeNull();
  });

  test("still up needs a price or a for-sale line", () => {
    expect(probeVerdict({ text: FB_CHROME + " MacBook Pro 14 M1 Pro $630 Listed 5 days ago in Acton, MA", finalUrl: "https://www.facebook.com/marketplace/item/1" })?.gone).toBe(false);
    expect(probeVerdict({ text: "EVGA RTX 3090 for Sale in Boston, MA - OfferUp", finalUrl: "https://offerup.com/item/detail/x" })?.gone).toBe(false);
  });

  /**
   * REGRESSION: testing /log in|sign up/ against the WHOLE body matched every
   * OfferUp listing, because that text is in the site header on every page.
   * Six live listings came back "no opinion" and the probe could conclude
   * nothing. A real login wall says so at the top, or in the url.
   */
  test("a login link in the nav is not a login wall", () => {
    expect(probeVerdict({ text: "EVGA RTX 3090 for Sale in Boston, MA - OfferUp $365 Log in Sign up", finalUrl: "https://offerup.com/item/detail/x" })?.gone).toBe(false);
    expect(probeVerdict({ text: "Log in to continue to Facebook. Email or phone.", finalUrl: "https://www.facebook.com/login" })).toBeNull();
  });
});

/**
 * Routing. Audit P0-2: primary tabs lived in React state while the URL was
 * tracked separately, so Back from `/c/:id` changed the URL and left the detail
 * on screen, a refresh of Check/Saved/Settings returned to Deals, and the PWA
 * shortcut `/?tab=check` opened Deals because nothing read that parameter.
 *
 * `screenOf` is the single derivation both `popstate` and the first render use.
 */
describe("screenOf / tabOf", () => {
  test("every primary screen has a real route", async () => {
    const { screenOf } = await import("../web/src/App.tsx");
    expect(screenOf("/").name).toBe("deals");
    expect(screenOf("/check").name).toBe("check");
    expect(screenOf("/saved").name).toBe("saved");
    expect(screenOf("/settings").name).toBe("settings");
  });

  test("a trailing slash is the same screen", async () => {
    const { screenOf } = await import("../web/src/App.tsx");
    expect(screenOf("/check/").name).toBe("check");
    expect(screenOf("/saved/").name).toBe("saved");
  });

  test("a detail route carries its id", async () => {
    const { screenOf } = await import("../web/src/App.tsx");
    const s = screenOf("/c/3918");
    expect(s.name).toBe("detail");
    expect(s.name === "detail" && s.id).toBe(3918);
  });

  test("an unknown path falls back to deals, never to a blank screen", async () => {
    const { screenOf } = await import("../web/src/App.tsx");
    expect(screenOf("/nope").name).toBe("deals");
    expect(screenOf("/c/notanumber").name).toBe("deals");
    expect(screenOf("/?tab=check").name).toBe("deals");
  });

  test("detail belongs to no bottom tab", async () => {
    const { screenOf, tabOf } = await import("../web/src/App.tsx");
    expect(tabOf(screenOf("/c/1"))).toBeNull();
    expect(tabOf(screenOf("/"))).toBe("deals");
    expect(tabOf(screenOf("/check"))).toBe("check");
    expect(tabOf(screenOf("/saved"))).toBe("saved");
    // Settings is reachable but is not a bottom-bar destination.
    expect(tabOf(screenOf("/settings"))).toBeNull();
  });
});

/**
 * ── FEED SEGMENTATION ──────────────────────────────────────────────────────
 *
 * Audit P0-1: the Deals control said 20 and the view dead-ended at 13. Seven
 * listings were unreachable by any interaction, because the count came from one
 * population and the rows from another.
 *
 * The invariant is the whole fix: for every segment, the count MUST equal the
 * number of rows that segment actually serves.
 */
describe("feed segments", () => {
  const rows = [
    { call: "BUY", askingPriceCents: 20000 },
    { call: "BUY", askingPriceCents: 90000 },
    { call: "VERIFY", askingPriceCents: 15000 },
    { call: "VERIFY", askingPriceCents: 15000 },
    { call: "RISK", askingPriceCents: 5000 },
    { call: "FAIR", askingPriceCents: 30000 },
    { call: "PASS", askingPriceCents: 30000 },
    { call: "INSUFFICIENT_DATA", askingPriceCents: null },
    { call: "INSUFFICIENT_DATA", askingPriceCents: 45000 },
  ];

  test("every count equals the rows that segment serves", () => {
    const counts = segmentCounts(rows);
    for (const q of QUALITIES) {
      expect(counts[q]).toBe(applyQuality(rows, q).length);
    }
  });

  test("the named segments are exactly the audit's vocabulary", () => {
    const counts = segmentCounts(rows);
    // 9 rows, minus the one RISK — see the next test.
    expect(counts.all).toBe(8);
    expect(counts.ready).toBe(2);   // BUY only
    expect(counts.verify).toBe(2);
    expect(counts.risky).toBe(1);   // RISK is its own state, never a deal
    expect(counts.browse).toBe(2);  // FAIR + PASS
  });

  /**
   * ⚠ `all` DOES NOT MEAN EVERY ROW.
   *
   * Yish, 2026-08-31: *"I've decided that I don't actually want risky listings
   * to be in the all listings feed at all. I just want them to appear in the
   * risky listings when I click that tab."*
   *
   * Same argument §4 already made about "deals": a scam is not something you
   * browse past, it is something you were nearly sent to. The day this changed,
   * one of those RISK rows turned out to be a real scammer running two listings
   * at once.
   */
  test("RISK is excluded from all, and reachable only under its own tab", () => {
    expect(applyQuality(rows, "all").some((r) => r.call === "RISK")).toBe(false);
    expect(applyQuality(rows, "risky").map((r) => r.call)).toEqual(["RISK"]);
    // Nothing is hidden: the tab still counts it.
    expect(segmentCounts(rows).risky).toBe(1);
    // And `all` is exactly everything else.
    expect(applyQuality(rows, "all").length).toBe(rows.length - 1);
  });

  test("RISK is never counted as a deal", () => {
    // Audit §4. It used to sit under "ready", which is how a listing with an
    // open hard blocker got presented as somewhere to drive.
    const counts = segmentCounts(rows);
    expect(counts.ready + counts.verify + counts.browse + counts.risky).toBeLessThanOrEqual(counts.all);
    expect(applyQuality(rows, "ready").every((r) => r.call === "BUY")).toBe(true);
  });

  test("INSUFFICIENT_DATA is reachable only under all", () => {
    for (const q of ["ready", "verify", "risky", "browse"]) {
      expect(applyQuality(rows, q).some((r) => r.call === "INSUFFICIENT_DATA")).toBe(false);
    }
    expect(applyQuality(rows, "all").filter((r) => r.call === "INSUFFICIENT_DATA").length).toBe(2);
  });

  test("an unknown segment falls back to all rather than serving nothing", () => {
    // It degrades to `all`, which now means "everything except RISK" — so the
    // fallback must match `all` exactly, not the raw row count.
    const all = applyQuality(rows, "all").length;
    expect(applyQuality(rows, "bogus").length).toBe(all);
    expect(applyQuality(rows, "").length).toBe(all);
    expect(applyQuality(rows, "bogus").some((r) => r.call === "RISK")).toBe(false);
  });

  test("the price filter narrows counts and rows together", () => {
    const scoped = withinPrice(rows, 40000);
    const counts = segmentCounts(scoped);
    for (const q of QUALITIES) expect(counts[q]).toBe(applyQuality(scoped, q).length);
    // The $900 BUY is out; the unpriced row is out (Infinity, not free).
    expect(counts.ready).toBe(1);
    expect(scoped.some((r) => r.askingPriceCents === null)).toBe(false);
  });

  test("paging a segment cannot leave rows unreachable", () => {
    // The bug, stated as a test: page until you have `total`, and you must get
    // every row the count promised.
    for (const q of QUALITIES) {
      const filtered = applyQuality(rows, q);
      const seen: unknown[] = [];
      for (let off = 0; off < filtered.length; off += 2) seen.push(...filtered.slice(off, off + 2));
      expect(seen.length).toBe(segmentCounts(rows)[q]);
    }
  });
});

/**
 * The drive-time override. The Settings stepper wrote `driveMinutes` to
 * localStorage and nothing read it (audit P0-3); this is the server half.
 */
describe("parseDrive", () => {
  test("accepts the range the client stepper offers", () => {
    expect(parseDrive("5")).toBe(5);
    expect(parseDrive("25")).toBe(25);
    expect(parseDrive("90")).toBe(90);
  });

  test("absent or malformed means use the stored verdict", () => {
    // undefined, not a default: the feed row and the detail must agree unless
    // the caller explicitly asked for something else.
    expect(parseDrive(undefined)).toBeUndefined();
    expect(parseDrive("")).toBeUndefined();
    expect(parseDrive("soon")).toBeUndefined();
  });

  test("out of range is REJECTED, not clamped", () => {
    // Clamping here while the client did not would show 120 minutes on screen
    // and compute the verdict at 90.
    expect(parseDrive("0")).toBeUndefined();
    expect(parseDrive("4")).toBeUndefined();
    expect(parseDrive("91")).toBeUndefined();
    expect(parseDrive("-30")).toBeUndefined();
  });
});

/**
 * ── EVERY WORD THE ENGINE WRITES IS IN YISH'S VOICE ────────────────────────
 *
 * A headline, a reason and a seller question all end up either on his screen or
 * pasted into a message he sends a stranger. Two rules from him, both on
 * 2026-08-30, and both of them things a source-level grep would miss because
 * the strings are assembled from templates at runtime:
 *
 *   · **No em dashes.** One of his AI tells. It is in CLAUDE.md for everything
 *     written in his voice, and generated product copy is no exception.
 *   · **Never name a marketplace for the local channel.** *"it will say $625
 *     net on facebook ... because I don't just buy or sell from facebook."*
 *     The `facebook` channel means a LOCAL CASH SALE; printing the id states
 *     something untrue about where he trades.
 *
 * These assert on the ASSEMBLED output, not the source, which is the only place
 * a template can be caught putting them back.
 */
describe("engine copy", () => {
  const EM_DASH = "—";
  const price = (n: number) => n * 100;

  /** Runs the real verdict builder over a spread of shapes. */
  const verdicts = () => {
    const cases: Array<{ title: string; description: string; askingPriceCents: number | null }> = [
      { title: "NVIDIA GeForce RTX 4090 Founders Edition 24GB", description: "Works great, local pickup", askingPriceCents: price(1500) },
      { title: "RTX 3060 12GB Graphics Card Tested and Working", description: "Tested", askingPriceCents: price(400) },
      { title: "Apple MacBook Pro 14 M1 Pro 16GB 512GB", description: "Good condition", askingPriceCents: price(2000) },
      { title: "PS5 Disc Edition", description: "Boxed", askingPriceCents: price(700) },
      { title: "iPhone 13 128GB", description: "Clean", askingPriceCents: price(120) },
      { title: "Gaming PC", description: "Fast", askingPriceCents: null },
      { title: "Lot of 12 assorted laptop chargers", description: "Bulk", askingPriceCents: price(60) },
      { title: "Canon EOS R6 body", description: "Mint", askingPriceCents: price(900) },
      { title: "Replica Rolex Submariner", description: "AAA quality", askingPriceCents: price(200) },
    ];
    return cases.map((c) => {
      const signals = analyze({
        source: "craigslist", sourceId: "t", url: "https://boston.craigslist.org/x.html",
        title: c.title, description: c.description, askingPriceCents: c.askingPriceCents,
        location: "Newton, MA", postedAt: null, updatedAt: null,
        // One photo, so ZERO_PHOTOS does not fire on every case and short out
        // the verdict before the money prose is ever reached.
        photoUrls: ["https://example.test/a.jpg"], attributes: {}, raw: {},
      } as never);
      return buildVerdict({
        title: c.title, description: c.description,
        askingPriceCents: c.askingPriceCents, signals,
        match: matchSku(c.title, c.description),
      });
    });
  };

  test("no verdict ever contains an em dash", () => {
    for (const v of verdicts()) {
      const parts = [v.headline, v.reasoning, v.decidingUnknown ?? "", ...(v.questions ?? [])];
      for (const s of parts) {
        expect(s).not.toContain(EM_DASH);
      }
    }
  });

  test("no verdict ever names a marketplace for the local channel", () => {
    // "facebook" is an internal channel id meaning "local cash sale". eBay may
    // be named, because the fee arithmetic behind that channel really is eBay's.
    for (const v of verdicts()) {
      const said = `${v.headline} ${v.reasoning} ${v.decidingUnknown ?? ""}`.toLowerCase();
      expect(said).not.toContain("facebook");
      expect(said).not.toContain("craigslist");
      expect(said).not.toContain("offerup");
      expect(said).not.toContain("mercari");
    }
  });

  test("no seller question contains an em dash", () => {
    // These get pasted into a message to a real person.
    for (const bank of [BY_SIGNAL, BY_FIELD, FALLBACK]) {
      for (const q of Object.values(bank)) expect(q).not.toContain(EM_DASH);
    }
  });

  test("a BUY headline leads with the money, not the configured floor", () => {
    /**
     * Yish, 2026-08-30, on *"$625 net on facebook — clears your $135 floor"*:
     * *"I don't like how it relates things to my $ floor."* The floor still
     * decides the CALL and is still stated in the reasoning and shown as its
     * own row in The Numbers, where a number you can change belongs. It does
     * not get the headline.
     */
    const buys = verdicts().filter((v) => v.call === "BUY");
    expect(buys.length).toBeGreaterThan(0);
    for (const v of buys) {
      expect(v.headline.toLowerCase()).not.toContain("floor");
      expect(v.headline).toMatch(/\$[\d,]+/);
    }
  });
});

/**
 * The server half of the same filter vocabulary. These must agree with
 * `test/web-shell.test.ts` field for field: a mismatch means a control asks for
 * something the server ignores, and the filter silently does nothing.
 */
describe("feed discovery", () => {
  const rows = [
    { call: "BUY", title: "NVIDIA GeForce RTX 4090 24GB", source: "craigslist", category: "gpu", askingPriceCents: 150000, postedAt: "2026-08-25", priceDropCents: 0, score: 900 },
    { call: "BUY", title: "RTX 3060 12GB Graphics Card", source: "offerup", category: "gpu", askingPriceCents: 20000, postedAt: "2026-08-28", priceDropCents: 5000, score: 800 },
    { call: "VERIFY", title: "MacBook Pro 14 M1 Pro", source: "facebook", category: "laptop", askingPriceCents: 90000, postedAt: "2026-08-20", priceDropCents: 0, score: 700 },
    { call: "PASS", title: "PS5 Disc Edition", source: "mercari", category: "console", askingPriceCents: 45000, postedAt: null, priceDropCents: 12000, score: 600 },
    { call: "FAIR", title: "Dell laptop charger", source: "craigslist", category: "unknown", askingPriceCents: null, postedAt: "2026-08-29", priceDropCents: 0, score: 500 },
  ];

  test("search requires EVERY word, not any of them", () => {
    // "rtx 3060" must not return every RTX card.
    expect(matchesSearch("RTX 3060 12GB Graphics Card", "rtx 3060")).toBe(true);
    expect(matchesSearch("NVIDIA GeForce RTX 4090 24GB", "rtx 3060")).toBe(false);
    expect(matchesSearch("anything", "")).toBe(true);
  });

  test("search is case-insensitive and matches glued model numbers", () => {
    expect(matchesSearch("Gigabyte RTX3060 Ti OC", "rtx3060")).toBe(true);
    expect(matchesSearch("MACBOOK PRO", "macbook")).toBe(true);
  });

  test("category, source and price all narrow the set", () => {
    expect(applyDiscovery(rows, { ...NO_FILTERS, category: "gpu" }).length).toBe(2);
    expect(applyDiscovery(rows, { ...NO_FILTERS, source: "craigslist" }).length).toBe(2);
    expect(applyDiscovery(rows, { ...NO_FILTERS, maxPrice: 50000 }).length).toBe(2);
  });

  test("filters compose rather than replace each other", () => {
    const got = applyDiscovery(rows, { ...NO_FILTERS, category: "gpu", maxPrice: 50000 });
    expect(got.length).toBe(1);
    expect(got[0].title).toContain("3060");
  });

  test("an unpriced row is excluded by a price ceiling, not treated as free", () => {
    const got = applyDiscovery(rows, { ...NO_FILTERS, maxPrice: 100000 });
    expect(got.some((r) => r.askingPriceCents === null)).toBe(false);
  });

  test("the segment counts are computed over the DISCOVERY-filtered set", () => {
    // Search for "rtx" and the chips must say how many BUYs there are AMONG
    // RTX cards. Counting the whole feed would print a number you cannot reach.
    const scoped = applyDiscovery(rows, { ...NO_FILTERS, q: "rtx" });
    const counts = segmentCounts(scoped);
    expect(counts.all).toBe(2);
    expect(counts.ready).toBe(2);
    expect(counts.verify).toBe(0);
    for (const q of QUALITIES) expect(counts[q]).toBe(applyQuality(scoped, q).length);
  });

  test("sort orders by the thing it names", () => {
    expect(sortFeed(rows, "newest")[0].title).toContain("charger");
    expect(sortFeed(rows, "drop")[0].title).toContain("PS5");
    expect(sortFeed(rows, "price")[0].title).toContain("3060");
    expect(sortFeed(rows, "best")[0].title).toContain("4090");
  });

  test("unpriced rows sink under cheapest-first", () => {
    // "Cheapest first" with no price is not an answer.
    const out = sortFeed(rows, "price");
    expect(out[out.length - 1].askingPriceCents).toBeNull();
  });

  test("sort is stable, so paging cannot duplicate or drop a row", () => {
    // Half these rows have no postedAt; without the score fallback their order
    // is arbitrary and page 2 overlaps page 1.
    const a = sortFeed(rows, "newest").map((r) => r.title);
    const b = sortFeed(rows, "newest").map((r) => r.title);
    expect(a).toEqual(b);
  });

  test("parseFilters mirrors the client's URL model", () => {
    const q: Record<string, string> = {
      quality: "READY", q: "  rtx 3060  ", category: "GPU", source: "OfferUp",
      maxPrice: "50000", sort: "drop",
    };
    const f = parseFilters((k) => q[k]);
    expect(f).toEqual({
      quality: "ready", q: "rtx 3060", category: "gpu", source: "offerup",
      maxPrice: 50000, sort: "drop",
    });
  });

  test("parseFilters rejects junk instead of passing it through", () => {
    const f = parseFilters((k) => ({ sort: "sideways", maxPrice: "-3" } as Record<string, string>)[k]);
    expect(f.sort).toBe("best");
    expect(f.maxPrice).toBeNull();
  });

  test("the server caps the search the same way the client does", () => {
    const long = "a".repeat(500);
    expect(parseFilters((k) => (k === "q" ? long : undefined)).q.length).toBe(80);
  });
});


describe("new-since-you-looked counts", () => {
  const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  const WATERMARK = iso(60);

  const rows = [
    { call: "BUY", capturedAt: iso(10) },                  // new
    { call: "BUY", capturedAt: iso(600) },                 // old
    { call: "VERIFY", capturedAt: iso(5) },                // new
    { call: "RISK", capturedAt: iso(5) },                  // new, risky only
    { call: "PASS", capturedAt: iso(5) },                  // new
    { call: "FAIR", capturedAt: iso(600) },                // old
    { call: "INSUFFICIENT_DATA", capturedAt: iso(5) },     // new, but never counted in `all`
    { call: "INSUFFICIENT_DATA", capturedAt: iso(2) },     // ditto
  ];

  const seenAll = Object.fromEntries(QUALITIES.map((q) => [q, WATERMARK]));

  test("counts only rows captured after that segment's watermark", () => {
    const n = newSegmentCounts(rows, seenAll);
    expect(n.ready).toBe(1);    // one of the two BUYs is new
    expect(n.verify).toBe(1);
    expect(n.risky).toBe(1);
    expect(n.browse).toBe(1);   // the new PASS; the FAIR is old
  });

  /**
   * ⚠ THE HEADLINE RULE. Yish, 2026-09-01: *"exclude the cant tells in the all
   * category."* 549 of 704 live rows are `INSUFFICIENT_DATA`, so counting them
   * makes the All badge a permanently-lit three-digit number — wallpaper, which
   * trains the eye past the Buy-it badge beside it.
   */
  test("the all badge excludes can't-tells even though the all SEGMENT serves them", () => {
    const n = newSegmentCounts(rows, seenAll);
    // New rows in `all`: BUY, VERIFY, PASS, and two INSUFFICIENT_DATA. Only 3 count.
    expect(n.all).toBe(3);
    // ...while the segment itself still serves every one of them.
    expect(applyQuality(rows, "all").filter((r) => r.call === "INSUFFICIENT_DATA").length).toBe(2);
  });

  /**
   * A device that has never opened Risky must not be greeted with "26 new".
   * That is the inventory wearing a notification badge.
   */
  test("no watermark means zero, never everything", () => {
    const n = newSegmentCounts(rows, {});
    for (const q of QUALITIES) expect(n[q]).toBe(0);
  });

  test("a badge can never exceed its own segment count", () => {
    const n = newSegmentCounts(rows, seenAll);
    const total = segmentCounts(rows);
    for (const q of QUALITIES) expect(n[q]).toBeLessThanOrEqual(total[q]!);
  });

  /** A row with no capture time cannot be proven new, so it is not claimed as new. */
  test("an undated row is never counted", () => {
    const n = newSegmentCounts([{ call: "BUY", capturedAt: null }], seenAll);
    expect(n.ready).toBe(0);
  });

  describe("parseSeen", () => {
    test("round-trips the segments it recognises", () => {
      const seen = parseSeen(JSON.stringify({ ready: WATERMARK, verify: WATERMARK }));
      expect(seen.ready).toBe(WATERMARK);
      expect(seen.verify).toBe(WATERMARK);
      expect(seen.risky).toBeUndefined();
    });

    /** Garbage in the query string must degrade to "no badges", never throw. */
    test("junk yields no watermarks rather than an exception", () => {
      expect(parseSeen("not json")).toEqual({});
      expect(parseSeen("[1,2,3]")).toEqual({});
      expect(parseSeen(undefined)).toEqual({});
      expect(parseSeen(JSON.stringify({ ready: "yesterday" }))).toEqual({});
      expect(parseSeen(JSON.stringify({ nonsense: WATERMARK }))).toEqual({});
    });
  });
});
