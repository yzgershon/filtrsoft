/**
 * bun run agent:install   [--remove]
 *
 * Make `bun run agent` start itself at logon and stay running.
 *
 * Yish, 2026-09-04: *"if I have to even think to crawl then that adds friction
 * to the automation of the app."*
 *
 * The server already queues a crawl by itself every 45 minutes — but only while
 * an agent is polling, and until now the agent existed exactly as long as
 * somebody remembered to open a terminal and leave it there. One reboot and the
 * whole automation was off with nothing saying so. **"My PC is on" and "crawls
 * are happening" have to be the same statement.**
 *
 * ── AT LOGON, NOT AT BOOT, AND THAT IS NOT A DETAIL ────────────────────────
 *
 * A task set to "run whether the user is logged on or not" gets session 0, which
 * has no desktop. Mercari must run headed (Cloudflare challenges headless
 * Chrome every single time), and a headed browser with nowhere to draw either
 * fails outright or hangs until the agent's own 12-minute timeout kills it.
 * Logon gives it a real desktop.
 *
 * ── WHY A GENERATED .cmd ───────────────────────────────────────────────────
 *
 * The token lives in `.env`, which `bun run` loads for its own child and which
 * nothing launching from the Startup folder knows anything about. The wrapper
 * reads it exactly the way `scripts/daily.cmd` already does, so there is one
 * pattern here rather than two — and it is generated rather than committed
 * because it holds this machine's absolute path to bun.exe.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.cwd();
const CMD = join(ROOT, "scripts", "agent.cmd");

/**
 * ⚠ THE STARTUP FOLDER, NOT `schtasks /SC ONLOGON`.
 *
 * The scheduled-task route needs administrator rights for a logon trigger and
 * fails with a bare `ERROR: Access is denied.` without them. The Startup folder
 * needs none, runs in the logged-on user's own session — which is what gives
 * Mercari's headed Chrome a desktop to draw on — and is a file, so uninstalling
 * is deleting it.
 *
 * It also leaves a VISIBLE console window on purpose. The agent already prints
 * what it is doing, a hidden background process is one nobody can debug, and
 * "the window is gone" is a far better symptom than silent inaction.
 */
const STARTUP = join(homedir(), "AppData", "Roaming", "Microsoft", "Windows",
  "Start Menu", "Programs", "Startup");
const LINK = join(STARTUP, "Filtrsoft Agent.cmd");
const remove = process.argv.includes("--remove");

if (remove) {
  try { rmSync(LINK); console.log(`removed ${LINK}`); }
  catch { console.log("nothing installed in Startup"); }
  process.exit(0);
}

/**
 * ⚠ `process.execPath` IS THE RIGHT ANSWER AND `"bun"` IS NOT.
 *
 * Task Scheduler does not inherit an interactive shell's PATH reliably, and on
 * this machine bun lives under a WinGet package directory nobody would type
 * from memory. Resolving it from the running process is exact by construction.
 */
const BUN = process.execPath;
if (!existsSync(BUN)) {
  console.error(`cannot resolve bun (looked at ${BUN})`);
  process.exit(1);
}

mkdirSync(join(ROOT, "scripts"), { recursive: true });
mkdirSync(join(ROOT, "logs"), { recursive: true });

/**
 * ⚠ THE RESTART LOOP IS THE POINT, NOT A FLOURISH.
 *
 * The agent polls forever, but a crash — a network stack reset, a Playwright
 * process that takes the parent down with it — leaves the machine on and the
 * automation silently off, which is the exact failure this task exists to
 * prevent. Ten seconds between attempts is long enough not to spin on a
 * permanent error and short enough that a blip costs nothing.
 *
 * A permanent error still shows up: it will fill `logs/agent.log` with the same
 * line, which is a far better symptom than silence.
 */
writeFileSync(CMD, [
  "@echo off",
  `cd /d "${ROOT}"`,
  `for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="FILTRSOFT_PUSH_TOKEN" set FILTRSOFT_PUSH_TOKEN=%%b`,
  ":loop",
  `echo [%date% %time%] starting agent >> "${join(ROOT, "logs", "agent.log")}"`,
  `"${BUN}" run agent >> "${join(ROOT, "logs", "agent.log")}" 2>&1`,
  `echo [%date% %time%] agent exited, restarting in 10s >> "${join(ROOT, "logs", "agent.log")}"`,
  "timeout /t 10 /nobreak > nul",
  "goto loop",
  "",
].join("\r\n"));
console.log(`wrote ${CMD}`);

if (!existsSync(STARTUP)) {
  console.error(`no Startup folder at ${STARTUP}`);
  process.exit(1);
}

/**
 * A one-line launcher rather than a `.lnk`: a shortcut needs COM to create,
 * while a `.cmd` calling the real `.cmd` is something anyone can open, read and
 * delete without a tool.
 *
 * ⚠ NOT RUN AS SYSTEM, and there is no version of this that should be. The
 * agent drives Chrome profiles under this user's home directory holding the
 * Facebook, OfferUp and Mercari sessions. Any other account gets a different
 * profile root and no logins, and every crawl then fails in a way that reads
 * exactly like being signed out.
 */
writeFileSync(LINK, `@echo off\r\nstart "" "${CMD}"\r\n`);

console.log(`installed ${LINK}`);
console.log("The agent now starts at every logon and restarts itself if it dies.");
console.log(`logs: ${join(ROOT, "logs", "agent.log")}`);
console.log("\nStart it now without logging out:");
console.log(`  start "" "${CMD}"`);
console.log("Uninstall:  bun run agent:install --remove");
