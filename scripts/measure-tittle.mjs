/**
 * Where exactly is the dot on a Space Grotesk "i"?
 *
 * The wordmark wants the tittle in the brand gradient and the stem in ink,
 * with the real letter "i" left in the DOM — so the split has to be a
 * background stop measured in em, not a guess. This prints that number.
 *
 * node scripts/measure-tittle.mjs
 */
import { chromium } from "playwright-core";

const CHROME = process.env.FILTRSOFT_CHROME_PATH
  ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
</head><body></body></html>`);
await page.evaluate(() => document.fonts.load('700 400px "Space Grotesk"'));
await page.evaluate(() => document.fonts.ready);

const out = await page.evaluate(() => {
  const SZ = 400;                 // big, so one pixel is 1/400 em
  const c = document.createElement("canvas");
  c.width = 400; c.height = 800;
  const x = c.getContext("2d");
  x.font = `700 ${SZ}px "Space Grotesk"`;
  x.textBaseline = "alphabetic";
  const BASE = 600;               // baseline y in canvas px
  x.fillStyle = "#fff";
  x.fillText("i", 60, BASE);

  const m = x.measureText("i");
  const px = x.getImageData(0, 0, c.width, c.height).data;
  // Which canvas rows contain any ink?
  const inked = [];
  for (let y = 0; y < c.height; y++) {
    let any = false;
    for (let xx = 0; xx < c.width; xx++) if (px[(y * c.width + xx) * 4 + 3] > 40) { any = true; break; }
    inked.push(any);
  }
  const first = inked.indexOf(true);
  const last = inked.lastIndexOf(true);
  // The gap between the tittle and the stem is the run of blank rows inside.
  let gapStart = -1, gapEnd = -1;
  for (let y = first; y <= last; y++) {
    if (!inked[y] && gapStart === -1) gapStart = y;
    else if (inked[y] && gapStart !== -1 && gapEnd === -1) { gapEnd = y; break; }
  }
  const em = (v) => +(v / SZ).toFixed(4);
  return {
    fontSize: SZ,
    ascent: m.fontBoundingBoxAscent,
    tittleTopFromBaseline: em(BASE - first),
    tittleBottomFromBaseline: em(BASE - gapStart),
    stemTopFromBaseline: em(BASE - gapEnd),
    gapRows: gapEnd - gapStart,
    // What CSS needs: distance from the TOP of the inline box down to the
    // middle of that gap, in em. background-clip:text paints from that top.
    splitFromInlineTop: em(m.fontBoundingBoxAscent - (BASE - (gapStart + gapEnd) / 2)),
    inlineBoxTopFromBaselineEm: em(m.fontBoundingBoxAscent),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
