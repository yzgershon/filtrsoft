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
  restoreLimit, FEED_PAGE, FEED_LIMIT_MAX,
} from "../web/src/nav.ts";
import { listedAge } from "../web/src/lib.tsx";

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
    expect(tabOf({ name: "more" })).toBe("more");
  });

  /**
   * ⚠ SETTINGS LIGHTS MORE; DETAIL STILL LIGHTS NOTHING.
   *
   * This test asserted that Settings lit nothing, which was right while it was
   * a gear in the top bar. It is a row inside the More hub now, so the tab that
   * got you there has to stay lit — the original bug this file guards against
   * was the bar DISAGREEING with the screen, and a dark bar on a screen you
   * reached from the bar is the same disagreement pointing the other way.
   */
  test("screens reached through More light More", () => {
    expect(tabOf({ name: "settings" })).toBe("more");
    expect(tabOf({ name: "how" })).toBe("more");
  });

  test("detail and the top-bar screens light nothing", () => {
    // The old shell lit Check while a detail was open, because the tab was
    // separate state that the route never corrected.
    expect(tabOf({ name: "detail", id: 12 })).toBeNull();
    // Notifications and Account hang off the top bar, not the tab bar.
    expect(tabOf({ name: "notifications" })).toBeNull();
    expect(tabOf({ name: "account" })).toBeNull();
  });

  /**
   * The invariant, restated for a hub: a lit tab is either the screen itself or
   * the hub that screen was reached through. Written as an explicit map rather
   * than relaxed to "anything goes", so a route that lights the WRONG tab still
   * fails — which is the whole point of the check.
   */
  test("no path can light a tab it does not belong to", () => {
    const HUB: Record<string, string> = { settings: "more", how: "more" };
    const paths = ["/", "/check", "/saved", "/more", "/settings", "/how",
      "/notifications", "/account", "/c/9", "/junk"];
    for (const p of paths) {
      const s = screenOf(p);
      const t = tabOf(s);
      if (t !== null) expect(t).toBe(HUB[s.name] ?? s.name);
    }
  });
});

describe("mergeSettings", () => {
  /**
   * ⚠ `driveVersion` IS STAMPED ON EVERY READ, so a merged object is the
   * defaults PLUS that marker rather than the defaults exactly. It exists to
   * make the 15 -> 20 migration below run once and never again.
   */
  const defaults = { ...DEFAULT_SETTINGS, driveVersion: 2 };

  test("empty storage is the defaults", () => {
    // `null`, `""` and `"{}"` all parse to an empty object and take the same
    // path, so all three come back stamped. Only CORRUPT input short-circuits
    // to the raw defaults — see the fallback test below.
    for (const empty of [null, "", "{}"]) {
      expect(mergeSettings(empty)).toEqual(defaults);
      expect(mergeSettings(empty).driveMinutes).toBe(20);
    }
  });

  /**
   * ⚠ A STORED VALUE EQUAL TO THE OLD DEFAULT IS NOT A CHOICE.
   *
   * Yish, 2026-08-31: *"can you change it to like $100 profit with a 20 min
   * drive."* Settings are written to localStorage in full on every change, so
   * his phone held `driveMinutes: 15` whether he had chosen it or never touched
   * the stepper — and a plain merge keeps 15 forever, which reads as the change
   * not landing.
   */
  test("the old drive default migrates to the new one, exactly once", () => {
    expect(mergeSettings(JSON.stringify({ driveMinutes: 15 })).driveMinutes).toBe(20);

    // Any OTHER value is a real choice and is left alone.
    expect(mergeSettings(JSON.stringify({ driveMinutes: 45 })).driveMinutes).toBe(45);
    expect(mergeSettings(JSON.stringify({ driveMinutes: 5 })).driveMinutes).toBe(5);

    // And once stamped it never runs again — someone who deliberately picks 15
    // after the migration keeps 15.
    expect(mergeSettings(JSON.stringify({ driveMinutes: 15, driveVersion: 2 })).driveMinutes).toBe(15);
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
    // Nothing corrupt reaches the migration, so nothing gets stamped either.
    expect(mergeSettings("{oops").driveVersion).toBeUndefined();
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

describe("restoreLimit", () => {
  /**
   * Yish, 2026-08-31: *"if I'm halfway down the listings and click one then go
   * back I want to stay where I am down there."* Restoring the OFFSET without
   * restoring the row count lands you somewhere you have never been, on a
   * screen that looks like it worked — the offset simply clamps to the bottom
   * of a one-page feed.
   */
  test("asks for at least a page and never more than the server serves", () => {
    expect(restoreLimit(0)).toBe(FEED_PAGE);
    expect(restoreLimit(1)).toBe(FEED_PAGE);
    expect(restoreLimit(FEED_PAGE)).toBe(FEED_PAGE);
    expect(restoreLimit(119)).toBe(119);
    // 200 is `/v1/feed`'s own cap on `limit`. Asking past it is silently
    // truncated, which is the same bug one layer down.
    expect(restoreLimit(400)).toBe(FEED_LIMIT_MAX);
    expect(restoreLimit(FEED_LIMIT_MAX)).toBe(FEED_LIMIT_MAX);
  });

  test("a missing or nonsense count is a page, not a crash", () => {
    expect(restoreLimit(NaN)).toBe(FEED_PAGE);
    expect(restoreLimit(-5)).toBe(FEED_PAGE);
    expect(restoreLimit(87.6)).toBe(87);
  });
});


/**
 * The age tag on the card photo.
 *
 * ⚠ THE VALUABLE CASE IS THE `null`, not the formatting. Yish, 2026-09-01:
 * *"anything that was listed for more than 3 days doesnt have the tag at all
 * this way not every post has a tag."* A tag on every card is a column; a tag
 * on a few is a signal, and most of the feed is older than three days.
 */
describe("listedAge", () => {
  const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
  const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

  test("minutes under an hour", () => {
    expect(listedAge(agoIso(20 * MIN))).toBe("20 Min");
    expect(listedAge(agoIso(59 * MIN))).toBe("59 Min");
  });

  /** Never "0 Min" — a listing that just landed still has an age. */
  test("floors at one minute rather than zero", () => {
    expect(listedAge(agoIso(3_000))).toBe("1 Min");
    expect(listedAge(agoIso(0))).toBe("1 Min");
  });

  test("hours, singular at one", () => {
    expect(listedAge(agoIso(HR))).toBe("1 Hr");
    expect(listedAge(agoIso(4 * HR))).toBe("4 Hrs");
    expect(listedAge(agoIso(23 * HR))).toBe("23 Hrs");
  });

  test("days, singular at one", () => {
    expect(listedAge(agoIso(DAY))).toBe("1 Day");
    expect(listedAge(agoIso(2 * DAY))).toBe("2 Days");
    expect(listedAge(agoIso(3 * DAY))).toBe("3 Days");
  });

  /**
   * ⚠ THE CUTOFF IS "THE LABEL WOULD HAVE TO SAY 4", NOT "72 HOURS EXACTLY".
   *
   * `"3 Days"` covers the whole fourth day (72h–95:59), the same way `"2 Days"`
   * covers the third. Cutting at exactly 72.0 hours would leave `"3 Days"`
   * displayable for a one-hour window in its entire life — a label in the
   * vocabulary Yish asked for that essentially never renders.
   */
  test("three days covers the whole fourth day", () => {
    expect(listedAge(agoIso(3 * DAY + HR))).toBe("3 Days");
    expect(listedAge(agoIso(3 * DAY + 23 * HR))).toBe("3 Days");
  });

  test("goes silent once it would have to say four — the whole point of the tag", () => {
    expect(listedAge(agoIso(4 * DAY))).toBeNull();
    expect(listedAge(agoIso(22 * DAY))).toBeNull();
  });

  /**
   * Facebook often gives no post date at all. No date means no tag, never a
   * guessed one — the tag's only job is to mark what is worth racing for, and a
   * fabricated "1 Min" would send him after a week-old listing.
   */
  test("no date and bad dates produce no tag", () => {
    expect(listedAge(null)).toBeNull();
    expect(listedAge(undefined)).toBeNull();
    expect(listedAge("")).toBeNull();
    expect(listedAge("not a date")).toBeNull();
  });

  /** A seller's timezone can put a listing in the future. Clamp, never "-3 Hrs". */
  test("a future timestamp clamps instead of going negative", () => {
    expect(listedAge(new Date(Date.now() + 3 * HR).toISOString())).toBe("1 Min");
  });
});
