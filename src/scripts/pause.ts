/**
 * bun run pause            toggle
 * bun run pause --on       pause  (crawls stop)
 * bun run pause --off      resume
 * bun run pause --status   print state, change nothing
 *
 * ONE SWITCH FOR EVERY AUTOMATION THAT TOUCHES THIS LAPTOP.
 *
 * Yish, 2026-09-06: *"sometimes I want to conserve battery or im doing
 * something on my computer that wont allow popups and im aware that every 45
 * minutes a crawl runs on my laptop so I need a way to stop it ... there should
 * be like 1 shortcut or button on my computer to turn it on and off."*
 *
 * ── WHAT ACTUALLY RUNS ON HIS MACHINE, AND WHY ONE FLAG IS NOT ENOUGH ───────
 *
 * Two independent things, and a switch that only caught one would be worse than
 * none, because it would look like it worked:
 *
 *   1. `Filtrsoft Agent.cmd` in the Startup folder. Loops forever, polls
 *      `/v1/jobs/next` every 15s, and runs whatever the server queued. The
 *      server queues a crawl every 45 minutes, but ONLY while an agent has
 *      polled inside the last 120s (`AGENT_FRESH_MS` in api/jobs.ts).
 *   2. The `Filtrsoft Daily Crawl` scheduled task at 10:00. It runs `daily.ts`
 *      DIRECTLY and never asks the server anything, so pausing the agent alone
 *      would leave a browser opening on his screen at ten in the morning.
 *
 * ⚠ THE AGENT STOPS POLLING WHEN PAUSED, AND THAT IS THE MECHANISM, NOT A SIDE
 * EFFECT. No poll means the server sees no agent within `AGENT_FRESH_MS`, so it
 * stops queueing — the work is never created rather than created and skipped.
 * A paused agent that kept polling would drain the queue and throw the jobs
 * away, and `/v1/jobs/next` hands a job out exactly once.
 *
 * Updated collectors still report a paused node to Settings without refreshing
 * dispatch presence or claiming jobs. Older collectors appear offline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * ⚠ NOT IN THE REPO. A pause has to survive `git checkout`, a rebuild and a
 * reboot, and it must never be committed — a flag file that lands in a commit
 * would silently pause a fresh clone. `~/.filtrsoft` already holds the browser
 * profiles, so the machine-local state is all in one place.
 */
export const PAUSE_DIR = join(homedir(), ".filtrsoft");
export const PAUSE_FILE = join(PAUSE_DIR, "paused");

export function isPaused(): boolean {
  return existsSync(PAUSE_FILE);
}

/** When it was paused, or null. Never throws — an unreadable flag still means paused. */
export function pausedAt(): Date | null {
  try {
    const d = new Date(readFileSync(PAUSE_FILE, "utf8").trim());
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

export function pausedFor(): string {
  const at = pausedAt();
  if (!at) return "";
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Close any crawl browser that is open RIGHT NOW.
 *
 * Pausing has to take effect immediately or it does not solve the problem he
 * described — a window already on screen is the thing interrupting him.
 *
 * ⚠ MATCHED ON THE PROFILE PATH, NEVER ON THE IMAGE NAME. Every crawl Chrome is
 * launched with `--user-data-dir` under `~/.filtrsoft` (browser/launch.mjs), and
 * that string appears in its command line and in no other Chrome on the
 * machine. Killing by image name would close HIS browser with every tab in it.
 *
 * ⚠ AND `/T`, BECAUSE CHROME IS A PROCESS TREE. Killing the parent leaves the
 * renderers and the GPU process behind, which keeps the profile lock held and
 * makes the next crawl fail to open it.
 */
export function killCrawlBrowsers(): number {
  try {
    const out = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*\\.filtrsoft\\*' } | " +
      "Select-Object -ExpandProperty ProcessId",
    ], { encoding: "utf8", timeout: 20_000 });
    const pids = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try { execFileSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
    }
    return pids.length;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────── the toggle itself

if (import.meta.main) {
  const has = (k: string) => process.argv.includes(`--${k}`);
  const want = has("status") ? isPaused()
    : has("on") ? true
    : has("off") ? false
    : !isPaused();

  if (!has("status") && want !== isPaused()) {
    if (want) {
      mkdirSync(PAUSE_DIR, { recursive: true });
      writeFileSync(PAUSE_FILE, new Date().toISOString());
      const killed = killCrawlBrowsers();
      if (killed) console.log(`  closed ${killed} crawl browser window(s) that were already open`);
    } else {
      rmSync(PAUSE_FILE, { force: true });
    }
  }

  const paused = isPaused();
  console.log("");
  if (paused) {
    console.log("  \x1b[43m\x1b[30m  CRAWLS ARE PAUSED  \x1b[0m");
    console.log("");
    console.log("  No browser windows will open. Nothing runs at 10:00 either.");
    const since = pausedFor();
    if (since) console.log(`  Paused ${since} ago.`);
    console.log("");
    console.log("  \x1b[90mSettings shows this computer as paused. It will not claim collection jobs.\x1b[0m");
  } else {
    console.log("  \x1b[42m\x1b[30m  CRAWLS ARE RUNNING  \x1b[0m");
    console.log("");
    console.log("  Auto-crawl every 45 min, plus the daily run at 10:00.");
    console.log("  Windows open off-screen, so they should not interrupt you.");
  }
  console.log("");
  console.log("  \x1b[90mRun this again to switch it back.\x1b[0m");
  console.log("");
}
