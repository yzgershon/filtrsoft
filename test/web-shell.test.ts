/**
 * The shell's pure half: routing, settings and the feed query.
 *
 * Every case here is a bug that shipped. The 2026-08-30 audit found the URL and
 * the visible screen disagreeing, a segment control whose counts did not match
 * what you could reach, and two settings that were written to localStorage and
 * never read. All four are string problems, so they are pinned here rather than
 * in a browser — a test that needs a DOM is a test that gets skipped.
 */
import { describe, expect, test } from "bun:test";
import {
  screenOf, tabOf, mergeSettings, clampDrive, feedQuery, checkQuery,
  DEFAULT_SETTINGS, DRIVE_MIN, DRIVE_MAX,
  NO_FILTERS, filtersFromSearch, searchFromFilters, activeFilterCount, feedUrl, sourceLabel,
} from "../web/src/nav.ts";

describe("screenOf", () => {
  test("maps every primary route", () => {
    expect(screenOf("/")).toEqual({ name: "deals" });
    expect(screenOf("/check")).toEqual({ name: "check" });
    expect(screenOf("/saved")).toEqual({ name: "saved" });
    expect(screenOf("/settings")).toEqual({ name: "settings" });
  });

  test("a trailing slash is the same screen", () => {
    // A PWA launched from a home-screen icon can arrive at `/check/`. That
    // used to fall through to Deals, so the shortcut opened the wrong tab.
    expect(screenOf("/check/")).toEqual({ name: "check" });
    expect(screenOf("/saved/")).toEqual({ name: "saved" });
    expect(screenOf("/settings/")).toEqual({ name: "settings" });
    expect(screenOf("/c/3918/")).toEqual({ name: "detail", id: 3918 });
  });

  test("detail carries a numeric id", () => {
    expect(screenOf("/c/3918")).toEqual({ name: "detail", id: 3918 });
    expect(screenOf("/c/1")).toEqual({ name: "detail", id: 1 });
  });

  test("anything unrecognised is Deals, never a blank screen", () => {
    for (const p of ["/c/abc", "/c/", "/nope", "/share", "/settings/x", ""]) {
      expect(screenOf(p)).toEqual({ name: "deals" });
    }
  });
});

describe("tabOf", () => {
  test("lights the tab that matches the screen", () => {
    expect(tabOf({ name: "deals" })).toBe("deals");
    expect(tabOf({ name: "check" })).toBe("check");
    expect(tabOf({ name: "saved" })).toBe("saved");
  });

  test("detail and settings light nothing", () => {
    // The old shell lit Check while a detail was open, because the tab was
    // separate state that the route never corrected.
    expect(tabOf({ name: "detail", id: 12 })).toBeNull();
    expect(tabOf({ name: "settings" })).toBeNull();
  });

  test("no path can light a tab that is not the screen you are on", () => {
    for (const p of ["/", "/check", "/saved", "/settings", "/c/9", "/junk"]) {
      const s = screenOf(p);
      const t = tabOf(s);
      if (t !== null) expect(t).toBe(s.name as typeof t);
    }
  });
});

describe("mergeSettings", () => {
  test("empty storage is the defaults", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("{}")).toEqual(DEFAULT_SETTINGS);
  });

  test("a stored value overrides only its own key", () => {
    const s = mergeSettings(JSON.stringify({ hideGone: false }));
    expect(s.hideGone).toBe(false);
    expect(s.driveMinutes).toBe(DEFAULT_SETTINGS.driveMinutes);
    expect(s.askOutcomes).toBe(DEFAULT_SETTINGS.askOutcomes);
  });

  test("corrupt storage falls back instead of throwing", () => {
    // This runs inside a `useState` initialiser. A throw there is a blank
    // screen with no error anyone can see.
    for (const bad of ["{oops", "null", "[]", "42", '"hi"']) {
      expect(mergeSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test("a key from a future version does not erase the known ones", () => {
    const s = mergeSettings(JSON.stringify({ somethingNew: 1, reduceMotion: true }));
    expect(s.reduceMotion).toBe(true);
    expect(s.driveMinutes).toBe(DEFAULT_SETTINGS.driveMinutes);
  });
});

describe("clampDrive", () => {
  test("stays inside the window the server honours", () => {
    // /v1/checks/:id ignores anything outside 5..90, so a stepper that let you
    // past either end would show a number the verdict did not use.
    expect(clampDrive(0)).toBe(DRIVE_MIN);
    expect(clampDrive(-30)).toBe(DRIVE_MIN);
    expect(clampDrive(1000)).toBe(DRIVE_MAX);
    expect(clampDrive(95)).toBe(DRIVE_MAX);
  });

  test("snaps to the 5-minute step", () => {
    expect(clampDrive(15)).toBe(15);
    expect(clampDrive(17)).toBe(15);
    expect(clampDrive(18)).toBe(20);
  });

  test("stepping down from the floor and up from the ceiling is a no-op", () => {
    expect(clampDrive(DRIVE_MIN - 5)).toBe(DRIVE_MIN);
    expect(clampDrive(DRIVE_MAX + 5)).toBe(DRIVE_MAX);
  });
});

describe("feedQuality", () => {
  test("the segment travels to the server, not a client filter", () => {
    // The Deals control said 20 and the view dead-ended at 13, because the
    // other 341 rows were never fetched.
    const q = feedQuery({ limit: 60, offset: 0, quality: "ready", hideGone: true });
    expect(q).toContain("quality=ready");
    expect(q).toContain("limit=60");
    expect(q).toContain("offset=0");
  });

  test("paging keeps the segment", () => {
    const q = feedQuery({ limit: 60, offset: 60, quality: "verify", hideGone: true });
    expect(q).toContain("offset=60");
    expect(q).toContain("quality=verify");
  });

  test("hideGone is INVERTED onto ?gone=1", () => {
    // The server hides delisted rows by default, so the switch asks for them
    // when it is off. Sending gone=1 while hiding was the original no-op.
    expect(feedQuery({ limit: 60, offset: 0, quality: "all", hideGone: true })).not.toContain("gone=1");
    expect(feedQuery({ limit: 60, offset: 0, quality: "all", hideGone: false })).toContain("gone=1");
  });
});

describe("checkQuery", () => {
  test("carries the drive time the user set", () => {
    expect(checkQuery(3918, 25)).toBe("/v1/checks/3918?drive=25");
  });

  test("clamps before asking, so the URL and the engine agree", () => {
    expect(checkQuery(1, 500)).toBe(`/v1/checks/1?drive=${DRIVE_MAX}`);
    expect(checkQuery(1, 0)).toBe(`/v1/checks/1?drive=${DRIVE_MIN}`);
  });
});

/**
 * ── DISCOVERY ──────────────────────────────────────────────────────────────
 *
 * Audit §20. The client's URL model and the server's query model are two
 * separate implementations of one filter vocabulary; if they ever disagree, a
 * control asks for something the server does not understand and silently gets
 * everything back, which reads as "the filter did nothing". Both are pinned
 * here against the same expectations.
 */
describe("filters in the URL", () => {
  test("an empty search is the default filter state", () => {
    expect(filtersFromSearch("")).toEqual(NO_FILTERS);
    expect(filtersFromSearch("?")).toEqual(NO_FILTERS);
  });

  test("a round trip preserves every field", () => {
    const f = { quality: "ready" as const, q: "rtx 3060", category: "gpu", source: "offerup", maxPrice: 50000, sort: "drop" as const };
    expect(filtersFromSearch(searchFromFilters(f))).toEqual(f);
  });

  test("defaults are OMITTED from the URL", () => {
    // A URL that reads ?quality=all&q=&category=&source=&sort=best after every
    // interaction is one nobody shares and one whose back button steps through
    // states that look identical.
    expect(searchFromFilters(NO_FILTERS)).toBe("");
    expect(searchFromFilters({ ...NO_FILTERS, q: "ps5" })).toBe("?q=ps5");
  });

  test("junk in the URL falls back rather than breaking the feed", () => {
    const f = filtersFromSearch("?quality=banana&sort=sideways&maxPrice=-9");
    expect(f.quality).toBe("all");
    expect(f.sort).toBe("best");
    expect(f.maxPrice).toBeNull();
  });

  test("the search is capped, so a pasted essay cannot become the query", () => {
    expect(filtersFromSearch(`?q=${"a".repeat(500)}`).q.length).toBe(80);
  });

  test("the badge counts filters, NOT quality or sort", () => {
    // Both are always set to something, so counting either shows "2 filters"
    // on a screen where nothing has been filtered.
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, quality: "ready", sort: "newest" })).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, q: "ps5" })).toBe(1);
    expect(activeFilterCount({ ...NO_FILTERS, q: "ps5", category: "console", source: "offerup", maxPrice: 100 })).toBe(4);
  });

  test("the feed URL carries every filter plus paging", () => {
    const u = feedUrl({
      limit: 60, offset: 60, hideGone: false,
      filters: { quality: "ready", q: "rtx", category: "gpu", source: "facebook", maxPrice: 50000, sort: "newest" },
    });
    for (const bit of ["limit=60", "offset=60", "quality=ready", "q=rtx", "category=gpu", "source=facebook", "maxPrice=50000", "sort=newest", "gone=1"]) {
      expect(u).toContain(bit);
    }
  });

  test("hideGone is still inverted onto ?gone=1", () => {
    expect(feedUrl({ limit: 60, offset: 0, hideGone: true, filters: NO_FILTERS })).not.toContain("gone=1");
  });

  test("every source has a spoken label", () => {
    // "offerup" is not how anyone says it.
    expect(sourceLabel("offerup")).toBe("OfferUp");
    expect(sourceLabel("craigslist")).toBe("Craigslist");
    // An unknown source degrades to its id rather than to blank.
    expect(sourceLabel("gumtree")).toBe("gumtree");
  });
});
