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
 * The mark is the wordmark's own split: `filtr` + `soft`, so the monogram is
 * `f` in ink and `s` in the accent — the icon and the wordmark say the same
 * thing rather than being two designs that happen to share a colour.
 *
 * ⚠ THE MASKABLE ONE IS NOT JUST THE SAME IMAGE. Android crops a maskable icon
 * to whatever shape the launcher uses — circle, squircle, teardrop — and only
 * the middle 80% is guaranteed to survive. So it is full-bleed with the mark at
 * 60%, while the plain icons carry their own rounded corners because nothing
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
const mark = ({ size, rx, scale }) => `<!doctype html>
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
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Inter,system-ui,-apple-system,sans-serif" font-weight="800"
        font-size="${Math.round(188 * scale)}" letter-spacing="${-8 * scale}">
    <tspan fill="${INK}">f</tspan><tspan fill="url(#g)">s</tspan>
  </text>
</svg>
</body></html>`;

const TARGETS = [
  { file: "icon-192.png", size: 192, rx: 112, scale: 1 },
  { file: "icon-512.png", size: 512, rx: 112, scale: 1 },
  { file: "apple-touch-icon.png", size: 180, rx: 112, scale: 1 },
  /**
   * ⚠ `rx: 0` AND A SMALLER MARK. A maskable icon that draws its own rounded
   * corners gets those corners cropped again by the launcher, which reads as a
   * dark ring around the icon on exactly the devices the maskable variant
   * exists to serve.
   */
  { file: "icon-maskable-512.png", size: 512, rx: 0, scale: 0.62 },
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
