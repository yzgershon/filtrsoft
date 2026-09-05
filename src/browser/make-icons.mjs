/**
 * node src/browser/make-icons.mjs
 *
 * Renders every app icon from ONE source of truth. **RUNS UNDER NODE** —
 * Playwright hangs under Bun on this machine (see launch.mjs).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The four PNGs in `web/public` were hand-made in August and nothing recorded
 * how. When the product was renamed on 2026-09-04 the SVG was a two-line edit
 * and the PNGs were a dead end: an installed PWA shows the 192 on the home
 * screen, so a stale icon would have kept the old brand on his phone
 * indefinitely while every screen inside the app said the new one. **A brand
 * asset that cannot be regenerated is a brand asset that goes stale.**
 *
 * ── THE MARK ───────────────────────────────────────────────────────────────
 *
 * Three shapes: a wide bar, a narrower bar, one rounded square. Wide, narrower,
 * the one — the product's own funnel. It replaced an `fs` monogram on
 * 2026-09-05; the options it was chosen from are in
 * docs/20260905-logo-options-preview.html.
 *
 * ⚠ THIS IS THE SAME GEOMETRY AS `web/src/brand.tsx` AND `web/public/icon.svg`,
 * ON THE SAME 24-UNIT GRID. Three files draw this mark and there is no build
 * step that derives one from another, so a change to the shape is a change in
 * three places. The grid is what makes that checkable: the numbers should be
 * character-for-character identical in all three.
 *
 * ⚠ THE INKS ARE NOT THE APP'S INKS. brand.tsx draws the bars at 40% and 75% of
 * --ink-2 so the logo loses the fight against the BUY and VERIFY chips beside
 * it. Alone on a home screen there is nothing to defer to, and at small sizes
 * those opacities read as dust, so the standalone icon uses 55% and 85% white.
 *
 * ⚠ THE MASKABLE ONE IS NOT JUST THE SAME IMAGE. Android crops a maskable icon
 * to whatever shape the launcher uses — circle, squircle, teardrop — and only
 * the middle 80% is guaranteed to survive. So it is full-bleed with a smaller
 * mark, while the plain icons carry their own rounded corners because nothing
 * crops those.
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.FILTRSOFT_CHROME_PATH
  ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join("web", "public");

/**
 * ⚠ THESE ARE `01-base.css`'s TOKENS, NOT A SECOND PALETTE.
 *
 * The icons this replaced were `#08070a` / `#f2f0f5` / orange `#ff8a3d` — a
 * palette the app stopped using when the VaultX system landed, and orange
 * appears nowhere on any screen now. So the one asset a user sees before the
 * app opens was the one asset off-brand. Keep these in step with `--bg`,
 * `--ink`, `--brand` and `--brand-2`.
 */
const BG = "#0a0e17";        // --bg
const INK = "#ffffff";       // --ink
const BRAND = "#00d4ff";     // --brand
const BRAND_2 = "#7b61ff";   // --brand-2

/**
 * `rx` is a FRACTION of the side, not pixels, so the corner radius stays
 * proportional at 192 and 512 rather than reading tight on one and soft on the
 * other. 112/512 is what the hand-made set used; keeping it means the new icon
 * sits at the same weight on the home screen as the old one did.
 */
/**
 * `rx` is a FRACTION of the side, not pixels, so the corner radius stays
 * proportional at 192 and 512 rather than reading tight on one and soft on the
 * other. 112/512 is what the hand-made set used; keeping it means the new icon
 * sits at the same weight on the home screen as the old one did.
 *
 * `box` is how many of the 512 units the mark spans. 340 is 66% of the tile,
 * which puts the drawn shapes at about 53% — a normal icon weight. The maskable
 * variant shrinks it so the whole mark clears the guaranteed-safe circle.
 */
const mark = ({ size, rx, box }) => {
  const scale = box / 24;
  const off = (512 - box) / 2;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body { margin:0; padding:0; background:transparent; }
  svg { display:block; }
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND_2}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="${BG}"/>
  <g transform="translate(${off} ${off}) scale(${scale})">
    <rect x="2.5"  y="3.2"  width="19"   height="2.8" rx="1.4" fill="${INK}" opacity=".55"/>
    <rect x="6.25" y="9"    width="11.5" height="2.8" rx="1.4" fill="${INK}" opacity=".85"/>
    <rect x="8.9"  y="14.8" width="6.2"  height="6.2" rx="2"   fill="url(#g)"/>
  </g>
</svg>
</body></html>`;
};

const TARGETS = [
  { file: "icon-192.png", size: 192, rx: 112, box: 340 },
  { file: "icon-512.png", size: 512, rx: 112, box: 340 },
  { file: "apple-touch-icon.png", size: 180, rx: 112, box: 340 },
  /**
   * ⚠ `rx: 0` AND A SMALLER MARK. A maskable icon that draws its own rounded
   * corners gets those corners cropped again by the launcher, which reads as a
   * dark ring around the icon on exactly the devices the maskable variant
   * exists to serve.
   *
   * 260 units puts the drawn shapes inside a 206x188 box, whose diagonal is 279
   * — comfortably inside the 410px circle Android guarantees. At the full 340
   * the diagonal is 366, which still fits a circle but leaves nothing for a
   * teardrop or a squircle corner to take.
   */
  { file: "icon-maskable-512.png", size: 512, rx: 0, box: 260 },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const t of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(mark(t));
  /**
   * Screenshot the SVG element, not the page: a page screenshot picks up the
   * body's own box, so a stray margin becomes a one-pixel transparent edge that
   * shows as a seam against a light launcher background.
   */
  const buf = await page.locator("svg").screenshot({ omitBackground: true });
  writeFileSync(join(OUT, t.file), buf);
  console.log(`  ${t.file}  ${t.size}x${t.size}  ${buf.length} bytes`);
  await page.close();
}
await browser.close();
console.log("icons written to web/public");
