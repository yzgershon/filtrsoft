/**
 * OfferUp and Mercari — used marketplaces. **RUNS UNDER NODE, NOT BUN.**
 *
 * **THESE ARE COMP SOURCES AS MUCH AS DEAL SOURCES, and Yish's correction on
 * 2026-08-25 is what makes the distinction matter.** They are used markets like
 * eBay, not local-pickup markets like Craigslist:
 *
 *   · **Mercari** is national, shipped, and takes ~10%. Its prices are
 *     eBay-BASIS and must NOT be discounted again by `netByChannel`.
 *   · **OfferUp** is mixed — mostly local pickup, but it has shipped listings
 *     too. Basis has to be decided per LISTING, not per source. Getting that
 *     wrong is the double-discount that read the NZXT build at $890 instead of
 *     $1,375.
 *
 * NEITHER NEEDS A LOGIN to browse search results, which is the whole reason
 * they are worth adding now: unlike Facebook, these can eventually run in the
 * container. They are browser-driven anyway because both render results client
 * side, exactly like Best Buy.
 *
 * DUMB WORKER: emits raw text lines, all parsing lives in TypeScript.
 */
import { openContext, emit, log, pause } from "./launch.mjs";

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

const SOURCES = {
  offerup: {
    url: (q, o) =>
      `https://offerup.com/search?q=${encodeURIComponent(q)}` +
      `&radius=${o.radiusMiles ?? 30}&lat=${o.lat ?? 42.337}&lon=${o.lon ?? -71.2092}` +
      `&sort=-posted`,
  },
  mercari: {
    // `sortBy=2&orderBy=1` is newest-first. Deals go fast, so recency beats
    // relevance on a feed that is polled repeatedly.
    url: (q) =>
      `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}&sortBy=2&orderBy=1&itemStatuses=1`,
  },
};

/**
 * Facebook is PROBE-ONLY here. Crawling it has its own worker with its own
 * scroll and card logic; this entry exists so the delisting pass can reuse one
 * probe implementation across all three browser sources instead of three.
 */
SOURCES.facebook = { url: () => { throw new Error("facebook search runs in fb-worker, not here"); } };

const source = SOURCES[command];
if (!source) { emit({ type: "error", msg: `unknown source ${command}` }); process.exit(1); }

const ctx = await openContext({
  // One profile per site, same rule as every other worker here.
  // Facebook's signed-in session lives in the shared `browser` profile that
  // `fb:login` writes; the marketplaces get one profile each.
  profile: command === "facebook" ? "browser" : `mkt-${command}`,
  chromePath: opts.chromePath,
  headless: opts.headless ?? false,
  /**
   * ⚠ HEADED BUT OFF-SCREEN BY DEFAULT. Every automated run here opens a real
   * Chrome window, and Yish uses this machine — a window that appears and takes
   * focus mid-crawl is the automation interrupting the person it exists to
   * serve. The login commands opt OUT, because a sign-in he cannot see is a
   * sign-in he cannot complete.
   */
  background: opts.background ?? true,
});

try {
  const page = await ctx.newPage();

  /**
   * PROBE MODE — is this listing still up?
   *
   * The Craigslist sweep diffs search results, which works because Craigslist
   * is a plain fetch and one request returns 300+ ids. Facebook and OfferUp
   * need a logged-in browser and their search pages do not enumerate our whole
   * inventory, so absence from a query proves nothing.
   *
   * So each url is visited. **The worker stays dumb**: it emits the page text
   * and the final url, and TypeScript decides what "gone" means — the same
   * split as every other worker here, so a wording change is a pure-function
   * fix with a fixture rather than another browser session.
   */
  for (const probe of opts.probe ?? []) {
    try {
      await page.goto(probe.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      /**
       * Facebook's item page is a SPA and renders the listing well after
       * domcontentloaded — a 2.5s pause captured only nav chrome, so a SOLD
       * listing looked identical to a live one. Wait for a price to appear,
       * and fall through on timeout rather than failing: a page with no price
       * is exactly what the classifier needs to see to say "no opinion".
       */
      await page.waitForFunction(
        () => /\$\s?\d/.test(document.body.innerText || ""),
        { timeout: 12_000 },
      ).catch(() => {});
      await pause(2000, 3200);
      const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 2500));
      /**
       * `document.title` is the reliable one on a SPA. Facebook names the tab
       * after the listing while it exists and falls back to a generic title
       * once it does not, and the body text cannot distinguish those two — a
       * dead item page still carries the sidebar's prices and category list.
       */
      const title = await page.title().catch(() => "");
      emit({ type: "probe", id: probe.id, url: probe.url, finalUrl: page.url(), text, title });
    } catch (e) {
      // A timeout is NOT evidence the listing is gone — it is evidence the
      // network or the site had a bad moment. Reported as an error so the
      // caller leaves the listing alone.
      emit({ type: "probe", id: probe.id, url: probe.url, finalUrl: "", text: "", error: String(e && e.message ? e.message : e) });
    }
  }

  /**
   * PHOTO MODE — every slide on a listing's DETAIL page, at full size.
   *
   * The search card carries one signed 250x250 and OfferUp signs per size, so
   * the only way to a real photo is to open the listing. Yish, 2026-08-31:
   * *"OfferUp listings only show 1 photo in worse resolution than the original,
   * when the original listing has like 4 photos."*
   *
   * ⚠ THE WORKER STAYS DUMB. It emits every `images.offerup.com` url it can
   * see, in DOM order, and `bestPhotos` in TypeScript decides which are gallery
   * slides and which are the "similar items" carousel — because that decision
   * is a size threshold with a fixture behind it, not a browser session.
   *
   * ⚠ AND IT NUDGES THE GALLERY FIRST. The slides lazy-load; without the wheel
   * and the pause only the hero has a real `src` and the rest are placeholders,
   * which is the same shape as the bug this exists to fix.
   */
  for (const item of opts.photosFor ?? []) {
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await pause(2600, 3800);
      await page.mouse.wheel(0, 500);
      await pause(1100, 1700);

      const urls = await page.evaluate(() => {
        const out = [];
        const push = (u) => { if (u && u.includes("images.offerup.com")) out.push(u); };
        for (const img of document.querySelectorAll("img")) {
          push(img.getAttribute("src"));
          const set = img.getAttribute("srcset") || "";
          for (const part of set.split(",")) push(part.trim().split(/\s+/)[0]);
        }
        return out;
      });
      /**
       * `document.title` again: OfferUp names the tab after the listing while
       * it exists. A page that no longer has a title with the item in it is a
       * page whose photos we must NOT write, or a delisted item quietly adopts
       * whatever the fallback page was showing.
       */
      const title = await page.title().catch(() => "");
      /**
       * ⚠ THE PAGE TEXT COMES BACK TOO, AND IT IS FREE.
       *
       * OfferUp and Mercari had 0% description coverage — 161 live listings
       * with nothing but a title, because a SEARCH CARD has no description and
       * nothing ever opened the item page for text. This visit is already
       * happening for the photos. The parsing is `parseOfferUpDetail` in
       * TypeScript, where a layout change is a fixture fix.
       */
      const text = await page.evaluate(
        () => ((document.querySelector("main") || document.body).innerText || "").slice(0, 4000),
      ).catch(() => "");
      emit({ type: "photos", id: item.id, url: item.url, finalUrl: page.url(), title, urls, text });
    } catch (e) {
      emit({ type: "photos", id: item.id, url: item.url, finalUrl: "", title: "", urls: [], error: String(e && e.message ? e.message : e) });
    }
    await pause(1500, 2800);
  }

  for (const query of opts.queries ?? []) {
    log(`${command}: ${query}`);
    await page.goto(source.url(query, opts), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pause(4500, 7000);

    const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
    if (/are you a human|access denied|unusual traffic|verify you are|checking your browser|press & hold/i.test(body)) {
      emit({ type: "error", msg: `bot challenge on "${query}"` });
      continue;
    }

    // Results lazy-load on both sites.
    for (let i = 0; i < (opts.scrolls ?? 3); i++) {
      await page.mouse.wheel(0, 1600);
      await pause(1200, 2200);
    }

    /**
     * Emit LINES and LINKS together. Prices and titles are in the text; the
     * item id is only in the href, and without an id there is no stable
     * `source_id`, so a re-crawl would insert duplicates instead of updating.
     */
    /**
     * ⚠ A BOT CHALLENGE IS NOT AN EMPTY RESULT, AND CONFLATING THEM COST NINE
     * DAYS.
     *
     * Mercari sits behind Cloudflare. Headless Chrome gets the interstitial —
     * `<title>Just a moment...</title>`, "Performing security verification",
     * a Ray ID — which contains two anchors and no items. The scraper read that
     * as "the search returned nothing", every query, and the run exited 0. So
     * `mercari: ok` was reported to the crawl button while the source had
     * produced **zero listings since 2026-08-26**, the day it was written.
     *
     * Name it. A source that is being blocked and a source with nothing new
     * look identical in the data and need completely different responses.
     */
    const blocked = await page.evaluate(() => {
      const t = document.title || "";
      const b = (document.body.innerText || "").slice(0, 600);
      if (/just a moment|attention required|access denied|verify you are human/i.test(t)) return t.trim();
      if (/security verification|checking your browser|unusual traffic/i.test(b)) return t.trim() || "challenge page";
      return null;
    });
    if (blocked) {
      emit({ type: "error", msg: `${command} served a bot challenge ("${blocked}") for "${query}" — the profile needs a headed run to clear it` });
      emit({ type: "cards", source: command, query, lines: [], links: [], blocked: true });
      await pause(3000, 5500);
      continue;
    }

    const { lines, links } = await page.evaluate(() => {
      const main = document.querySelector("main");
      const text = main && (main.innerText || "").length > 200
        ? main.innerText
        : (document.body.innerText || "");
      const hrefs = [...document.querySelectorAll("a[href]")]
        .map((a) => {
          /**
           * THE CARD'S PHOTO, which was never collected — so every OfferUp and
           * Mercari listing arrived with `photoUrls: []` and the engine
           * correctly but wrongly flagged ZERO_PHOTOS on all 97 of them.
           *
           * Both sites lazy-load, so `src` is often a placeholder while the
           * real URL sits in `srcset` or `data-src`. Take the LAST srcset
           * candidate because that list is ordered smallest-first and this
           * project's rule is highest resolution always.
           */
          const img = a.querySelector("img");
          let photo = "";
          if (img) {
            const set = img.getAttribute("srcset") || "";
            if (set) {
              const last = set.split(",").pop() || "";
              photo = last.trim().split(/\s+/)[0] || "";
            }
            if (!photo) photo = img.getAttribute("src") || img.getAttribute("data-src") || "";
            // A base64 placeholder is not a photo.
            if (photo.startsWith("data:")) photo = "";
          }
          return {
            href: a.getAttribute("href") || "",
            text: (a.innerText || "").trim().slice(0, 220),
            photo,
          };
        })
        .filter((l) => /\/(item|p)\//.test(l.href) && l.text.length > 4);
      return { lines: text.split("\n").map((s) => s.trim()).filter(Boolean), hrefs };
    }).then((r) => ({ lines: r.lines, links: r.hrefs }));

    emit({ type: "cards", source: command, query, lines, links });
    await pause(3000, 5500);
  }

  emit({ type: "done", stats: { queries: (opts.queries ?? []).length } });
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  await ctx.close().catch(() => {});
}
