/**
 * bun run agent
 *
 * The piece that lives on HIS PC and does what the container cannot.
 *
 * Yish, 2026-09-03: *"code a button in Filtrsoft that I click and put in a pin ...
 * that automatically starts the crawl ... so I dont need to waste my claude
 * usage asking you to crawl."*
 *
 * ── WHY IT POLLS ───────────────────────────────────────────────────────────
 *
 * filtrsoft.com is a Railway container and this desktop is behind a home router.
 * **The server cannot reach here.** So the button writes a row and this asks
 * for it, every 15 seconds, forever. Leave it running; it costs one tiny HTTP
 * request a quarter-minute and nothing else.
 *
 * It also has to be here rather than in the container for a second, independent
 * reason: Facebook, OfferUp and Mercari need a logged-in Chrome profile. Those
 * sessions are on this machine and this project's standing rule is that they
 * never leave it.
 *
 * ── WHAT IT ACTUALLY RUNS ──────────────────────────────────────────────────
 *
 * Exactly the commands that already exist and are already trusted:
 *
 *     bun run fb:crawl        then  bun run push --source facebook
 *     bun run ou:crawl              bun run push --source offerup
 *     bun run mc:crawl              bun run push --source mercari
 *
 * ⚠ IT SHELLS OUT RATHER THAN IMPORTING THEM. Each crawler drives Playwright
 * and several call `process.exit` on a bot challenge; imported into a
 * long-lived process, the first challenge would kill the agent and the button
 * would silently stop working until someone noticed. A child process that dies
 * is one failed job, reported as one failed job.
 */
import { spawn, execSync } from "node:child_process";

const API = (process.env.FILTRSOFT_API ?? "https://filtrsoft.com").replace(/\/$/, "");
const TOKEN = (process.env.FILTRSOFT_PUSH_TOKEN ?? "").trim();

const POLL_MS = 15_000;
/**
 * ⚠ A HARD CEILING PER SOURCE, BECAUSE A HUNG BROWSER IS THE FAILURE MODE.
 *
 * Playwright waiting on a page that will never load has no timeout of its own
 * here, and the job would sit `running` until the server's own 40-minute sweep
 * gave up on it. Killing the child at 12 minutes turns that into "offerup
 * timed out" while the other two sources still run.
 */
const PER_SOURCE_TIMEOUT_MS = 12 * 60_000;

if (!TOKEN) {
  console.error("FILTRSOFT_PUSH_TOKEN is not set. The agent cannot authenticate.");
  console.error("It must match the value set on Railway.");
  process.exit(1);
}

const auth = { authorization: `Bearer ${TOKEN}` };

/** Run one command, streaming its output, and resolve with what happened. */
function run(args: string[], label: string): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", args, { shell: true, cwd: process.cwd() });
    /**
     * ⚠ KEEP ONLY THE TAIL. A crawl prints thousands of lines and this string
     * is posted to the server and stored on the job row; buffering all of it
     * would put megabytes through an endpoint meant to carry a status.
     */
    const lines: string[] = [];
    const keep = (buf: Buffer) => {
      for (const l of buf.toString().split("\n")) {
        const t = l.trim();
        if (!t) continue;
        lines.push(t);
        if (lines.length > 40) lines.shift();
        process.stdout.write(`  ${label}: ${t}\n`);
      }
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    /**
     * ⚠ `child.kill()` DOES NOT KILL A PROCESS TREE ON WINDOWS, AND THAT MAKES
     * THE TIMEOUT A LIE.
     *
     * `shell: true` means the child is cmd.exe, which then launches bun, which
     * launches Chromium. Signalling cmd.exe leaves bun and the browser running
     * — so a hung Playwright session would survive its own timeout, keep the
     * profile locked, and make every later crawl fail with what looks like a
     * login error. `taskkill /T` is the documented way to take the whole tree.
     */
    const killTree = () => {
      if (child.pid == null) return;
      if (process.platform === "win32") {
        try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" }); }
        catch { /* already gone */ }
      } else {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      lines.push(`timed out after ${PER_SOURCE_TIMEOUT_MS / 60000} minutes`);
      killTree();
    }, PER_SOURCE_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, tail: lines.slice(-6).join(" | ").slice(0, 380) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, tail: String(e).slice(0, 380) });
    });
  });
}

async function report(id: number, body: Record<string, unknown>) {
  try {
    await fetch(`${API}/v1/jobs/${id}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /**
     * A failed status post must never abort the crawl that is already running.
     * The server's own stale-job sweep is the backstop if we go quiet.
     */
  }
}

/**
 * The crawl commands per source.
 *
 * ⚠ THE PHOTO PASS RUNS FOR OFFERUP AND IT IS NOT OPTIONAL. An OfferUp search
 * card carries one 250x250 thumbnail and no description; `ou:photos` opens each
 * listing for the real slides AND the description text. Without it those
 * listings arrive unpriceable — that was measured at 151 of them.
 */
const STEPS: Record<string, string[][]> = {
  facebook: [["run", "fb:crawl", "--headless"], ["run", "push", "--source", "facebook"]],
  offerup: [
    ["run", "ou:crawl", "--headless"],
    ["run", "ou:photos", "--limit", "40", "--headless"],
    ["run", "push", "--source", "offerup"],
  ],
  mercari: [["run", "mc:crawl", "--headless"], ["run", "push", "--source", "mercari"]],
};

async function doJob(job: { id: number; sources: string[] }) {
  console.log(`\njob #${job.id}: ${job.sources.join(", ")}`);
  const summary: Record<string, string> = {};

  for (const source of job.sources) {
    const steps = STEPS[source];
    if (!steps) { summary[source] = "unknown source"; continue; }

    await report(job.id, { progress: `${source}: crawling` });
    let failedAt: string | null = null;

    for (const args of steps) {
      const label = `${source}/${args[1]}`;
      const { ok, tail } = await run(args, label);
      if (!ok) { failedAt = `${args[1]}: ${tail}`; break; }
      /**
       * ⚠ REPORTED AFTER EACH STEP, not just at the end. A Facebook crawl runs
       * for minutes; without this the app shows "crawling" for the whole time
       * and there is no way to tell progress from a hang.
       */
      await report(job.id, { progress: `${source}: ${args[1]} done` });
    }

    summary[source] = failedAt ?? "ok";
    /**
     * ⚠ ONE SOURCE FAILING MUST NOT ABANDON THE OTHERS. A Facebook bot
     * challenge is common and says nothing about whether OfferUp will work.
     * Each source is recorded on its own and the loop continues.
     */
  }

  const anyOk = Object.values(summary).some((v) => v === "ok");
  await report(job.id, {
    status: anyOk ? "done" : "failed",
    result: summary,
    error: anyOk ? undefined : "every source failed",
    progress: Object.entries(summary).map(([k, v]) => `${k}: ${v === "ok" ? "ok" : "failed"}`).join(" · "),
  });
  console.log(`job #${job.id} finished: ${JSON.stringify(summary)}`);
}

console.log(`Filtrsoft agent watching ${API}`);
console.log("Leave this window open. Tap Start crawl in the app to trigger a run.\n");

let warnedOffline = false;

while (true) {
  try {
    const res = await fetch(`${API}/v1/jobs/next`, { headers: auth });
    if (res.status === 401) {
      console.error("Rejected: FILTRSOFT_PUSH_TOKEN does not match the server's.");
      process.exit(1);
    }
    const { job } = await res.json() as { job: { id: number; sources: string[] } | null };
    warnedOffline = false;
    if (job) await doJob(job);
  } catch (e) {
    /**
     * Offline is normal on a laptop and must not spam the console every 15
     * seconds — warn once per outage, then go quiet until it recovers.
     */
    if (!warnedOffline) {
      console.log(`(offline, will keep trying) ${(e as Error).message?.slice(0, 80) ?? ""}`);
      warnedOffline = true;
    }
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
