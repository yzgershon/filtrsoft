/**
 * node src/browser/check-live.mjs [baseUrl]
 *
 * The three behaviours from 2026-08-31 that only exist across a NAVIGATION, so
 * `ui-verify`'s per-screen assertions cannot see them: Back restores where you
 * were, opening a listing records it, and the record shows up under Check.
 */
import { chromium, devices } from "playwright-core";

const BASE = process.argv[2] ?? "https://filtrsoft.com";
const CHROME = process.env.FILTRSOFT_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const c = await b.newContext({ ...devices["Galaxy S24"] });
const p = await c.newPage();

const y = () => p.evaluate(() => {
  const pane = document.querySelector(".scroll");
  const host = pane && getComputedStyle(pane).overflowY === "auto" ? pane : document.scrollingElement;
  return Math.round(host.scrollTop);
});

await p.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForSelector(".gcard", { timeout: 45000 });

const more = p.locator(".more");
if (await more.count()) { await more.click(); await p.waitForTimeout(2500); }
const rows = await p.locator(".gcard").count();

const card = p.locator(".gcard .gopen").nth(Math.min(rows - 1, Math.floor(rows * 0.7)));
await card.scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
const leftAt = await y();
const title = (await p.locator(".gcard b").nth(Math.min(rows - 1, Math.floor(rows * 0.7))).textContent())?.trim().slice(0, 34);
await card.click();
await p.waitForSelector(".lh h1", { timeout: 45000 });

const back = p.locator(".dback");
console.log(`opened  ${p.url().replace(BASE, "")}  "${title}"`);
console.log(`back overlay: ${await back.count() ? "present" : "MISSING"}`);
await back.first().click();
await p.waitForSelector(".gcard", { timeout: 45000 });
await p.waitForTimeout(1500);
const backAt = await y();
const rowsBack = await p.locator(".gcard").count();
console.log(`rows ${rows} -> ${rowsBack} · y ${leftAt} -> ${backAt} · drift ${Math.abs(backAt - leftAt)}`);

await p.goto(`${BASE}/check`, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1200);
const head = await p.locator(".recent h4").textContent().catch(() => null);
const n = await p.locator(".hrow").count();
const first = await p.locator(".hrow .htitle").first().textContent().catch(() => null);
console.log(`"${head}": ${n} row(s), newest "${(first ?? "").trim().slice(0, 34)}"`);

await b.close();
