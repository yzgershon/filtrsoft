/**
 * node src/browser/shots.mjs <label> [baseUrl] [device]
 *
 * Screenshots every screen on a real device profile, for looking at.
 *
 * ⚠ THIS IS NOT A CHECKER AND MUST NOT GROW ASSERTIONS. `ui-verify.mjs` is
 * where the measurements live, and the reason that file exists is that two of
 * the worst bugs in the 2026-08-30 audit were INVISIBLE in a screenshot. This
 * is the other half: a design change that measures correctly can still look
 * wrong, and the only way to know is to look at it.
 *
 * Runs under NODE. Playwright hangs under Bun on this machine (launch.mjs).
 */
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const LABEL = process.argv[2] ?? "shots";
const BASE = process.argv[3] ?? "http://localhost:3177";
const DEVICE = process.argv[4] ?? "Galaxy S24";
const CHROME = process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join("docs", "ui", LABEL);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ ...devices[DEVICE] });
const page = await ctx.newPage();

/** The first listing id in the feed, so the detail shot is a real listing. */
const feed = await (await fetch(`${BASE}/v1/feed?limit=1`)).json();
const first = feed.items?.[0]?.id;

const SHOTS = [
  ["deals", "/"],
  ["deals-browse", "/?quality=browse"],
  ["check", "/check"],
  ["saved", "/saved"],
  ["settings", "/settings"],
  ...(first ? [["detail", `/c/${first}`]] : []),
];

for (const [name, path] of SHOTS) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
  // Card entrance is 320ms plus up to 200ms of stagger; shoot after it settles.
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  const full = join(OUT, `${name}-full.png`);
  await page.screenshot({ path: full, fullPage: true });
  console.log(`  ${name.padEnd(14)} ${path}`);
}

await browser.close();
console.log(`\n${OUT}`);
