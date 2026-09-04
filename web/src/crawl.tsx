/**
 * The "Start crawl" button, its PIN, and the live status of a running job.
 *
 * Yish, 2026-09-03: *"code a button in Assyze that I click and put in a pin
 * (im the only one that knows the pin thats the point) the pin will be 2008 and
 * then that automatically starts the crawl and im guessing that the crawl will
 * only work if my computer is on."*
 *
 * He guessed right, and that guess is the whole design. Facebook, OfferUp and
 * Mercari need a logged-in Chrome profile, which lives on his desktop and never
 * leaves it. The server cannot reach that machine, so the button queues a job
 * and `bun run agent` there collects it.
 *
 * ⚠ WHICH MEANS THIS SCREEN'S HARDEST JOB IS SAYING "YOUR PC IS OFF" CLEARLY.
 * A queued job with no agent looks exactly like a running one unless the UI
 * distinguishes them, and the first time he taps this from school with the
 * machine asleep, a spinner would read as a broken feature. `agentOnline` comes
 * back with every poll for precisely this.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Again, Alert, Check, Cross, Scan } from "./icons.tsx";
import { toast } from "./lib.tsx";

export interface CrawlJob {
  id: number;
  status: "queued" | "running" | "done" | "failed" | "expired";
  sources: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: string | null;
  result: Record<string, string> | null;
  error: string | null;
}

interface JobState {
  job: CrawlJob | null;
  configured: boolean;
  agentOnline: boolean;
  agentSeenAt: string | null;
}

const LIVE = (s?: string) => s === "queued" || s === "running";

export function CrawlPanel() {
  const [st, setSt] = useState<JobState | null>(null);
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinBox = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/v1/jobs/latest");
      if (!r.ok) return;
      setSt(await r.json());
    } catch { /* offline; the next poll retries */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * ⚠ POLL ONLY WHILE A JOB IS LIVE. A crawl takes minutes and the status is
   * worth watching; an idle screen polling every 4 seconds forever is a
   * battery cost with nothing to show for it. Falls back to nothing the moment
   * the job reaches a terminal state.
   */
  useEffect(() => {
    if (!LIVE(st?.job?.status)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [st?.job?.status, load]);

  async function start() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Couldn't start the crawl."); return; }
      setAsking(false);
      setPin("");
      toast(d.alreadyRunning ? "A crawl is already running" : "Crawl queued");
      void load();
    } catch {
      setError("Couldn't reach Assyze.");
    } finally { setBusy(false); }
  }

  if (!st) return null;

  const job = st.job;
  const live = LIVE(job?.status);

  return (
    <div className="sgroup">
      <div className="shead"><Scan size={14} /> Crawl for new listings</div>
      <div className="scard">
        {!st.configured ? (
          <p className="snote nolead">
            Not set up yet. <b>ASSYZE_CRAWL_PIN</b> has to be set on the server
            before this button can do anything.
          </p>
        ) : (
          <>
            <div className="srow static">
              <span className="stext">
                <b>Facebook, OfferUp and Mercari</b>
                <span>
                  These need your logged-in browser, so they only crawl on your
                  PC. Craigslist keeps running on its own every 3 minutes.
                </span>
              </span>
            </div>

            {/**
              * ⚠ THE PC'S STATE IS SHOWN BEFORE THE BUTTON, NOT AFTER A FAILED
              * TAP. Knowing the crawl will wait is the difference between a
              * feature that behaves oddly and one that told you what it would
              * do.
              */}
            <div className="srow static">
              <span className="stext">
                <b className={st.agentOnline ? "ok" : "danger"}>
                  {st.agentOnline ? "Your PC is online" : "Your PC is offline"}
                </b>
                <span>
                  {st.agentOnline
                    ? "Ready to crawl now."
                    : "A crawl will wait in the queue until your PC is on and the agent is running."}
                </span>
              </span>
              <span className={`dotlive${st.agentOnline ? " on" : ""}`} aria-hidden="true" />
            </div>

            {live && (
              <div className="srow static">
                <span className="stext">
                  <b>{job!.status === "queued" ? "Waiting for your PC" : "Crawling now"}</b>
                  <span>{job!.progress ?? job!.sources.join(", ")}</span>
                </span>
                <span className="spin" aria-hidden="true" />
              </div>
            )}

            {!live && job && (
              <div className="srow static">
                <span className="stext">
                  <b className={job.status === "done" ? "ok" : "danger"}>
                    {job.status === "done" ? "Last crawl finished" : `Last crawl ${job.status}`}
                  </b>
                  <span>
                    {job.result
                      ? Object.entries(job.result)
                        .map(([k, v]) => `${k}: ${v === "ok" ? "ok" : "failed"}`).join(" · ")
                      : job.error ?? job.progress ?? "No detail."}
                    {job.finishedAt ? ` · ${new Date(job.finishedAt).toLocaleString()}` : ""}
                  </span>
                </span>
              </div>
            )}

            {!asking && !live && (
              <button className="srow" onClick={() => {
                setAsking(true); setError(null);
                setTimeout(() => pinBox.current?.focus(), 60);
              }}>
                <span className="stext">
                  <b>Start crawl</b>
                  <span>Takes a few minutes. New listings appear as they land.</span>
                </span>
                <Again size={16} />
              </button>
            )}

            {asking && (
              <div className="srow static confirm">
                <span className="stext">
                  <b>Enter your PIN</b>
                  <span>Four digits. Only you know it.</span>
                </span>
                <form className="pinrow" onSubmit={(e) => { e.preventDefault(); void start(); }}>
                  {/*
                    * `inputMode="numeric"` is what actually gives a number pad
                    * on Android; `type="password"` keeps it out of shoulder
                    * view. `one-time-code` stops a password manager offering to
                    * save it as an account password.
                    */}
                  <input
                    ref={pinBox}
                    type="password" inputMode="numeric" autoComplete="one-time-code"
                    pattern="[0-9]*" maxLength={8} value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••" aria-label="PIN" />
                  <button className="btn3" type="button"
                    onClick={() => { setAsking(false); setPin(""); setError(null); }}>
                    <Cross size={13} />
                  </button>
                  <button className="btn2 sm" type="submit" disabled={busy || pin.length < 4}>
                    {busy ? "Starting…" : "Start"}
                  </button>
                </form>
              </div>
            )}

            {error && (
              <p className="snote danger"><Alert size={13} /> {error}</p>
            )}

            {!st.agentOnline && (
              <p className="snote">
                The agent is the small window you leave open on your PC. If it
                is not running, open a terminal in <b>C:\Dev\assyze</b> and run{" "}
                <b>bun run agent</b>.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
