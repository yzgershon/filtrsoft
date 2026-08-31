/**
 * node src/browser/measure.mjs [baseUrl] [device]
 *
 * Prints how much of the first screen is chrome, per screen, and audits every
 * button on it. Scratch tool for the density pass; the assertions worth keeping
 * move into `ui-verify.mjs`.
 */
import { chromium, devices } from "playwright-core";
import { auditButtons } from "./button-audit.mjs";

const BASE = process.argv[2] ?? "http://localhost:3177";
const DEV = process.argv[3] ?? "Galaxy S24";
const CHROME = process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const c = await b.newContext({ ...devices[DEV] });
const p = await c.newPage();

const H = c._options?.viewport?.height ?? devices[DEV].viewport.height;

for (const [name, path, firstContent] of [
  ["deals", "/", ".sect"],
  ["check", "/check", ".paste"],
  ["saved", "/saved", ".subtabs"],
  ["settings", "/settings", ".sgroup"],
]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  await p.waitForTimeout(700);
  const m = await p.evaluate((sel) => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const head = r(".feedhead"), bar = r(".topbar"), first = r(sel);
    return {
      bar: bar ? Math.round(bar.height) : null,
      head: head ? Math.round(head.height) : null,
      firstTop: first ? Math.round(first.top) : null,
    };
  }, firstContent);
  const pct = m.firstTop == null ? "?" : `${Math.round((m.firstTop / H) * 100)}%`;
  console.log(`${name.padEnd(9)} bar ${String(m.bar).padStart(3)}  head ${String(m.head).padStart(3)}  first content at ${String(m.firstTop).padStart(3)}px of ${H} (${pct})`);
}

// ---------------------------------------------------------------- buttons
console.log("\nbutton audit — 44px target, contents inside the box, ink off the edge, centred:");
let bad = 0;
/** The first listing, so the detail screen is audited on real content. */
const one = (await (await fetch(`${BASE}/v1/feed?limit=1`)).json()).items?.[0]?.id;

for (const [name, path, open] of [
  ["deals", "/"], ["check", "/check"], ["saved", "/saved"], ["settings", "/settings"],
  ...(one ? [["detail", `/c/${one}`]] : []),
  // The sheet and the lightbox are BEHIND an interaction, which is exactly why
  // they are the ones that go unlooked-at.
  ["filters", "/", ".filtbtn"],
  ...(one ? [["lightbox", `/c/${one}`, ".galshot"]] : []),
]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  await p.waitForTimeout(700);
  if (open) { await p.locator(open).first().click(); await p.waitForTimeout(500); }
  const rows = await p.evaluate(auditButtons);
  console.log(`  ${name.padEnd(9)} ${rows.length} buttons`);
  for (const r of rows) {
    if (!r.problems.length) continue;
    bad++;
    console.log(`  ${name.padEnd(9)} ${String(r.cls).slice(0, 24).padEnd(25)} "${r.label}" ${r.w}x${r.h}  ${r.problems.join(", ")}`);
  }
}
console.log(bad ? `\n${bad} problem buttons` : "\nevery button clears 44px, contains its ink, and centres it");

await b.close();
