/**
 * One-off: screenshot a local preview HTML so it can be checked before it is
 * handed over. The Claude in Chrome extension was not connected, and a preview
 * nobody looked at is exactly how a broken SVG ships.
 *
 * node scripts/shot-preview.mjs <html path> <out png> [fullPage]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [, , htmlPath, outPath, mode] = process.argv;
if (!htmlPath || !outPath) {
  console.error("usage: node scripts/shot-preview.mjs <html> <out.png> [full|top]");
  process.exit(1);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) { console.error("no chrome found"); process.exit(1); }

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle", timeout: 45_000 });
// Webfonts are the point of this page; do not shoot before they settle.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const fontLoaded = await page.evaluate(() => document.fonts.check('700 24px "Space Grotesk"'));
const warnShown = await page.evaluate(() => {
  const el = document.getElementById("fontwarn");
  return el ? getComputedStyle(el).display !== "none" : null;
});
// Every <use> must resolve to a symbol, or a mark renders as nothing at all.
const dangling = await page.evaluate(() =>
  [...document.querySelectorAll("use")]
    .map((u) => u.getAttribute("href"))
    .filter((h) => !document.querySelector(h)),
);

await page.screenshot({ path: outPath, fullPage: mode !== "top" });
console.log(JSON.stringify({ fontLoaded, warnShown, dangling: [...new Set(dangling)], errors }, null, 2));
await browser.close();
