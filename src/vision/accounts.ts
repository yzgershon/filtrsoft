/**
 * Claude account failover.
 *
 * Vision runs on subscriptions rather than the API, and a subscription can run
 * out mid-session. One account = one point of failure = the product silently
 * stops reading photos. So: try each account in turn, and remember which ones
 * are exhausted so we stop hammering them.
 *
 * Replace this whole file with a single API key when there's an API key. Until
 * then this is what keeps vision alive.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Account {
  name: string;
  configDir: string;
}

const HOME = homedir();

/** Order matters — first is preferred. Only accounts with credentials count. */
export const ACCOUNTS: Account[] = [
  { name: "yish", configDir: join(HOME, ".claude") },
  { name: "robbie", configDir: join(HOME, ".claude-robbie") },
  { name: "amitai", configDir: join(HOME, ".claude-amitai") },
].filter((a) => existsSync(join(a.configDir, ".credentials.json")));

/** name -> epoch ms when it's worth trying again. */
const exhausted = new Map<string, number>();

/** How long to skip an account after it reports a usage limit. */
const COOLDOWN_MS = 30 * 60_000;

export function availableAccounts(): Account[] {
  const now = Date.now();
  const live = ACCOUNTS.filter((a) => (exhausted.get(a.name) ?? 0) <= now);
  // If every account is cooling down, ignore the cooldowns rather than fail
  // outright — a stale cooldown must never be the reason nothing works.
  return live.length ? live : ACCOUNTS;
}

export function markExhausted(name: string) {
  exhausted.set(name, Date.now() + COOLDOWN_MS);
}

export function markWorking(name: string) {
  exhausted.delete(name);
}

/**
 * Does this output mean "this account is out of usage" rather than
 * "this listing failed"? Only the former should trigger failover — retrying a
 * genuinely broken listing on three accounts just burns three accounts.
 */
export function isUsageLimit(text: string): boolean {
  return /usage limit|rate limit|quota|out of (usage|credits)|limit reached|upgrade to (continue|pro)|try again (later|in|at)/i
    .test(text);
}

export function accountStatus() {
  const now = Date.now();
  return ACCOUNTS.map((a) => {
    const until = exhausted.get(a.name) ?? 0;
    return {
      name: a.name,
      available: until <= now,
      cooldownSecondsLeft: until > now ? Math.round((until - now) / 1000) : 0,
    };
  });
}
