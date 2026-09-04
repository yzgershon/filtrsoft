/**
 * Shared browser launcher for every scraped source.
 *
 * RUNS UNDER NODE, NOT BUN. Playwright hangs under Bun on this machine
 * (measured 2026-08-24: `chromium.launch()` never resolves; identical code under
 * Node 24 launches in ~3s). The rest of Filtrsoft is Bun because `bun:sqlite` is
 * the database, so the two split: Node drives browsers, Bun owns data.
 *
 * ONE PROFILE PER SITE. Facebook and eBay logins must not share a cookie jar —
 * a bot challenge or a logout on one should never take out the other, and
 * separate profiles keep each session's history looking like a normal person
 * using that one site.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const profilePath = (name) =>
  process.env.FILTRSOFT_BROWSER_PROFILE_ROOT
    ? join(process.env.FILTRSOFT_BROWSER_PROFILE_ROOT, name)
    : join(homedir(), ".filtrsoft", `${name}-profile`);

export async function openContext({ profile, chromePath, headless = false }) {
  const dir = profilePath(profile);
  mkdirSync(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, {
    executablePath: chromePath,
    headless,
    viewport: { width: 1400, height: 950 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: [
      // Drops the automation banner and the matching navigator.webdriver tell.
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
}

export const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
export const log = (msg) => emit({ type: "log", msg });

// Seeded jitter. A constant delay between actions is itself a fingerprint.
let seed = Date.now() % 2147483647;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
export const pause = (a = 800, b = 2200) => new Promise((r) => setTimeout(r, a + (b - a) * rnd()));

export async function scroll(page, steps) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 600 + Math.floor(rnd() * 500));
    await pause(500, 1400);
  }
}
