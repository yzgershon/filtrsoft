/**
 * bun run daily [--fast] [--dry]
 *
 * The once-a-day local routine: crawl the sources production CANNOT reach, then
 * push what it found to filtrsoft.com.
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 *
 * Production crawls Craigslist by itself, continuously — a plain `fetch()`, no
 * browser, no session. **Facebook Marketplace and OfferUp cannot run there and
 * never will**: they need a logged-in Chrome profile that Yish signs into by
 * hand, and session cookies do not go in a server image. So those two sources
 * only advance when this machine runs them.
 *
 * That asymmetry is exactly why the feed looked stale. Measured 2026-08-28:
 * 345 listings, of which 295 Craigslist and 50 Facebook, and the newest
 * Facebook capture was two days old while Craigslist was minutes old.
 *
 * ── THE RULES THIS FILE OBEYS ──────────────────────────────────────────────
 *
 * **SEQUENTIAL, NEVER PARALLEL.** Every crawler drives a real Chrome window at
 * human pace on purpose: the realistic penalty for looking like a bot is Yish's
 * ACCOUNT, not an HTTP 429. Two browsers racing is the single most bot-like
 * thing this system could do, and it would also fight over profile locks.
 *
 * **A FAILING SOURCE MUST NOT STOP THE REST.** A Facebook session expires
 * silently — the crawl returns nothing rather than erroring — and if that took
 * OfferUp and the push down with it, one stale cookie would freeze the whole
 * feed. Each step is independently caught and the summary says which ones
 * actually produced anything.
 *
 * **PUSH AFTER EACH SOURCE, not once at the end.** A crash in the last query
 * would otherwise discard everything the earlier ones found.
 *
 * **BOUNDED.** A fixed query list and per-query limits, so an unattended run
 * has a known ceiling on both time and requests.
 */
import { spawn } from "node:child_process";
import { db } from "../db/index.ts";

const has = (k: string) => process.argv.includes(`--${k}`);
const DRY = has("dry");
/** `--fast` halves the work, for when you want a run to finish in minutes. */
const FAST = has("fast");

/**
 * What to search for.
 *
 * Broad nouns beat specific models. "rtx 4070" finds one card; "graphics card"
 * finds every card including the ones the catalog has never heard of — and the
 * generative matcher can now resolve those, so narrow queries actively cost
 * coverage. Keep this list short: each entry is a browser session.
 */
const FB_QUERIES = ["gaming pc", "graphics card", "gaming laptop", "macbook", "iphone"];
const OU_QUERIES = ["graphics card", "gaming pc", "laptop"];

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m: string) => console.log(`[${ts()}] ${m}`);

/** Run a bun script to completion. Never throws — the caller decides. */
function run(args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("bun", ["run", ...args], { shell: true });
    let out = "";
    const done = (ok: boolean) => { clearTimeout(timer); resolve({ ok, out }); };
    const timer = setTimeout(() => {
      // A hung browser is the common failure. Kill it and move on rather than
      // letting an unattended run sit until morning.
      p.kill();
      out += `\n[timed out after ${Math.round(timeoutMs / 60000)}m]`;
      done(false);
    }, timeoutMs);
    p.stdout?.on("data", (d) => { out += d.toString(); });
    p.stderr?.on("data", (d) => { out += d.toString(); });
    p.on("close", (code) => done(code === 0));
    p.on("error", (e) => { out += String(e); done(false); });
  });
}

const countFor = (source: string) =>
  (db().query("SELECT COUNT(*) c FROM listings WHERE source=?").get(source) as { c: number }).c;

interface Step { label: string; ok: boolean; added: number; note: string }
const steps: Step[] = [];

async function crawlSource(source: string, script: string, queries: string[], perQuery: number) {
  const before = countFor(source);
  for (const q of queries.slice(0, FAST ? 2 : queries.length)) {
    log(`${source}: "${q}"`);
    if (DRY) continue;
    const r = await run([script, "--query", q, "--limit", String(perQuery)], 15 * 60_000);
    const tail = r.out.trim().split("\n").slice(-2).join(" | ").slice(0, 160);
    log(`  ${r.ok ? "ok" : "FAILED"} ${tail}`);
  }
  const added = countFor(source) - before;
  steps.push({
    label: `crawl ${source}`, ok: added > 0, added,
    note: added ? `${added} new listings` : "nothing new (session expired, or genuinely nothing)",
  });
  return added;
}

async function push(source: string) {
  if (DRY) return;
  if (!process.env.FILTRSOFT_PUSH_TOKEN) {
    steps.push({ label: `push ${source}`, ok: false, added: 0, note: "FILTRSOFT_PUSH_TOKEN not set — nothing sent" });
    return;
  }
  const r = await run(["push", "--source", source, "--since", "3", "--limit", "200"], 5 * 60_000);
  const line = r.out.trim().split("\n").filter(Boolean).pop() ?? "";
  steps.push({ label: `push ${source}`, ok: r.ok, added: 0, note: line.slice(0, 120) });
  log(`push ${source}: ${r.ok ? "ok" : "FAILED"} ${line.slice(0, 100)}`);
}

log(`daily routine starting${FAST ? " (fast)" : ""}${DRY ? " (dry run)" : ""}`);

await crawlSource("facebook", "fb:crawl", FB_QUERIES, FAST ? 12 : 20);
await push("facebook");

await crawlSource("offerup", "ou:crawl", OU_QUERIES, FAST ? 12 : 25);
await push("offerup");

/**
 * The delisting pass, LAST. Craigslist is swept in the container; these three
 * cannot be, because checking them needs the same logged-in browser that
 * crawling them does.
 *
 * Bounded to 40 per source per run and ordered by how stale our information
 * is, so it drains the backlog over several days rather than making 250
 * browser visits in one sitting.
 */
if (!DRY) {
  log("probing for delisted listings");
  const r = await run(["probe", "--limit", FAST ? "15" : "40"], 25 * 60_000);
  const line = r.out.trim().split(String.fromCharCode(10)).filter(Boolean).pop() ?? "";
  steps.push({ label: "probe delisted", ok: r.ok, added: 0, note: line.replace(/\[[0-9;]*m/g, "").slice(0, 90) });
}

console.log("");
console.log("\x1b[1mdaily routine\x1b[0m");
for (const s of steps) {
  const mark = s.ok ? "\x1b[32mok  \x1b[0m" : "\x1b[33mskip\x1b[0m";
  console.log(`  ${mark} ${s.label.padEnd(18)} ${s.note}`);
}
const total = steps.reduce((n, s) => n + s.added, 0);
console.log(`\n  ${total} new listings captured locally.`);
console.log("  Craigslist is NOT here on purpose — production crawls it continuously by itself.");
