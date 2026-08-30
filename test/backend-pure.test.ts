import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseModel } from "../src/catalog/derive.ts";
import { namedCatalogBrand } from "../src/catalog/match.ts";
import { isUnsupportedPrinter, resolveCategory, resolveProductType } from "../src/signals/product-type.ts";
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
import { cardToListing, parseCards, probeVerdict } from "../src/sources/marketplace.ts";
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
  test.each([
    ["Dell Precision 5760 + Charger", "tech", "laptop"],
    ["HP XL 17 Laptop Bag", "accessory", "laptop"],
    ["Lenovo P50 Mobile Workstation Laptop", "tech", "laptop"],
    ["Apple iMac A1312 with keyboard and mouse", "tech", "prebuilt"],
    ["Glass and Metal Computer Table", "furniture", null],
  ])("classifies %s", (title, kind, category) => {
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
