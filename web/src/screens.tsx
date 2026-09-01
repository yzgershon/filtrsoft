/**
 * Saved, Alerts, Settings, You, the nav bars and the outcome prompt.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Again, Alert, Bell, Card, Check, Clock, Cut, Gear, Grid, Save, Scan, Tag, User,
} from "./icons.tsx";
import type { Call, FeedItem, Hist } from "./types.ts";
import { Ghost } from "./icons.tsx";
import {
  type Settings, DRIVE_MIN, DRIVE_MAX, DRIVE_STEP, clampDrive,
} from "./nav.ts";
import {
  LABEL, money, ago, markAsked, toast, writeWatch, readWatch, toggleWatch,
  SUBKEY, urlB64ToBytes, deviceRef, Thumb,
} from "./lib.tsx";
import { Gcard } from "./feed.tsx";

export function Watchlist({ onOpen, onWatchChange, onBrowse }: {
  onOpen: (id: number) => void;
  onWatchChange: (n: number) => void;
  /** The empty state needs a way out. Audit §"Saved and Alerts". */
  onBrowse: () => void;
}) {
  const [sub, setSub] = useState<"listings" | "alerts" | "bought">("listings");
  const [ids, setIds] = useState<number[]>(readWatch);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [summary, setSummary] = useState<{ dropped: number; gone: number }>({ dropped: 0, gone: 0 });

  useEffect(() => {
    if (!ids.length) { setItems([]); return; }
    fetch(`/v1/watchlist?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setSummary(d.summary ?? { dropped: 0, gone: 0 });
        /**
         * PRUNE IDS THE SERVER NO LONGER KNOWS. Without this a purged listing
         * stays in localStorage forever and every future request carries a
         * dead id, so the saved count never matches what is on screen.
         */
        if (d.missing?.length) {
          const keep = ids.filter((i: number) => !d.missing.includes(i));
          writeWatch(keep); setIds(keep);
        }
      })
      .catch(() => setItems([]));
    // `ids` is intentionally the only dep: re-running on every render would
    // hammer the endpoint.
  }, [ids.join(",")]);

  const news: string[] = [];
  if (summary.dropped) news.push(`${summary.dropped} dropped in price`);
  if (summary.gone) news.push(`${summary.gone} ${summary.gone === 1 ? "is" : "are"} gone`);

  /**
   * ⚠ THE H1 ALWAYS RENDERS (audit §17). The empty state used to return early
   * with only a `<b>`, so the Saved screen had no heading at all and screen
   * readers got no landmark for it.
   *
   * **Alerts live here, not in Settings** (audit §12). A saved search is
   * discovery, not configuration — it was buried below Billing and Feed
   * settings, which is the wrong place for one of the few features that gives
   * anyone a reason to come back.
   */
  return (
    /**
     * ⚠ NOT `.sec`. That class carries `margin-top: var(--s6)` for the DETAIL
     * screen's stacked sections, and using it as a plain screen wrapper added
     * 32px of dead space above the badge on Saved and on Settings — measured as
     * the difference between those two screens and Deals, which does not wrap.
     */
    <div className="screen">
      <div className="feedhead">
        <span className="eyebrow alt">Watchlist</span>
        <h1>Your <span className="g">saved</span></h1>
        <p>
          {items === null ? "Loading…"
            : items.length === 0 ? "Bookmarks, and alerts for searches you save."
            : news.length ? news.join(" · ")
            : `${items.length} saved, nothing changed yet.`}
        </p>
      </div>

      <div className="subtabs" role="tablist" aria-label="Saved">
        <button role="tab" aria-selected={sub === "listings"} className={sub === "listings" ? "on" : ""}
          onClick={() => setSub("listings")}>Listings{items?.length ? ` (${items.length})` : ""}</button>
        <button role="tab" aria-selected={sub === "alerts"} className={sub === "alerts" ? "on" : ""}
          onClick={() => setSub("alerts")}>Alerts</button>
        {/* Purchases live under Saved because Saved is "your stuff", and a
            fourth bottom-nav item would cost the other three the room the 44px
            targets need. */}
        <button role="tab" aria-selected={sub === "bought"} className={sub === "bought" ? "on" : ""}
          onClick={() => setSub("bought")}>Bought</button>
      </div>

      {sub === "listings" && (
        !items ? (
          <div>{[0, 1].map((i) => <div className="skel" key={i} style={{ height: 240, marginBottom: 8 }} />)}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <span className="eic"><Save size={26} /></span>
            <b>Nothing saved yet</b>
            <p>Tap the bookmark on any listing. Saved listings are re-checked daily, and this is where a price drop or a disappearance shows up.</p>
            <button className="btn2" onClick={onBrowse}><Grid size={15} /> Browse deals</button>
          </div>
        ) : (
          <>
            <div className="grid">
              {items.map((i) => (
                <Gcard key={i.id} i={i} saved
                  onSave={() => { const n = toggleWatch(i.id); setIds(n); onWatchChange(n.length); }}
                  onOpen={() => onOpen(i.id)} />
              ))}
            </div>
            {/* Present tense: this is what the product does, not a promise. */}
            <p className="micro2">Saved on this device.</p>
          </>
        )
      )}

      {sub === "alerts" && <Alerts />}
      {sub === "bought" && <Purchases />}
    </div>
  );
}

/**
 * What Assyze has actually bought him.
 *
 * Yish, 2026-08-31: *"add a section in Assyze where it shows all of my
 * purchases with the help of assyze and make it have good ui."*
 *
 * ⚠ THE PAIRING IS THE FEATURE, NOT THE LIST. A list of things you bought is a
 * receipt. What you PAID beside what the engine said it was WORTH is the
 * product keeping score in public, and it is the only screen where the app can
 * be wrong in front of you. The first row is an i9-12900K he talked from $200
 * down to $170 against a $287 median — on a listing the engine had called FAIR,
 * "doesn't pay for the trip". Both numbers are on screen, including that one.
 *
 * ⚠ `engineCall` IS SHOWN EVEN WHEN IT DISAGREES. Hiding a FAIR on something he
 * bought and did well on would make this a trophy cabinet; the disagreements
 * are the rows worth reading.
 */
export function Purchases() {
  type Buy = {
    id: number; listingId: number; title: string; source: string;
    thumb: string | null; paidCents: number | null; worthCents: number | null;
    marginCents: number | null; engineCall: Call | null; askingPriceCents: number | null;
    boughtAt: string; notes: string | null;
  };
  const [d, setD] = useState<{ items: Buy[]; summary: any } | null>(null);

  useEffect(() => {
    fetch("/v1/purchases").then((r) => r.json()).then(setD).catch(() => setD({ items: [], summary: null }));
  }, []);

  if (!d) return <div>{[0, 1].map((i) => <div className="skel" key={i} style={{ height: 88, marginBottom: 8 }} />)}</div>;

  if (!d.items.length) {
    return (
      <div className="empty">
        <span className="eic"><Tag size={26} /></span>
        <b>Nothing bought yet</b>
        <p>When you buy something you found here, answer "what happened with this one?" and it lands on this page with what you paid against what it was worth.</p>
      </div>
    );
  }

  const s = d.summary;
  return (
    <>
      {/* The scoreboard first: the sum is the reason to open this screen. */}
      <div className="buysum">
        <div><span>Bought</span><b className="num">{s.count}</b></div>
        <div><span>Spent</span><b className="num">{money(s.spentCents)}</b></div>
        <div><span>Worth</span><b className="num">{money(s.worthCents)}</b></div>
        <div className="buysumhi">
          <span>Ahead</span>
          <b className={`num ${s.marginCents >= 0 ? "pos" : "neg"}`}>
            {s.marginCents >= 0 ? "+" : ""}{money(s.marginCents)}
          </b>
        </div>
      </div>

      <div className="buys">
        {d.items.map((b) => (
          <a className="buy" key={b.id} href={`/c/${b.listingId}`}>
            <span className="buyshot">
              {b.thumb ? <Thumb src={b.thumb} size={20} /> : <span className="noimg"><Ghost size={20} /></span>}
            </span>
            <span className="buybody">
              <b>{b.title}</b>
              <span className="buynums">
                <span className="num buypaid">{money(b.paidCents)}</span>
                {/* Asking price shown ONLY when he beat it — a strike-through
                    equal to what he paid is noise. */}
                {b.askingPriceCents && b.paidCents && b.askingPriceCents > b.paidCents
                  ? <s className="num">{money(b.askingPriceCents)}</s> : null}
                {b.marginCents != null && (
                  <span className={`num buymargin ${b.marginCents >= 0 ? "pos" : "neg"}`}>
                    {b.marginCents >= 0 ? "+" : ""}{money(b.marginCents)}
                  </span>
                )}
              </span>
              <span className="buymeta">
                {b.worthCents != null ? `worth ${money(b.worthCents)}` : "not priced"}
                {b.engineCall ? <> · engine said <em className={`b-${b.engineCall}`}>{LABEL[b.engineCall]}</em></> : null}
              </span>
            </span>
          </a>
        ))}
      </div>
      <p className="micro2">Recorded when you answer "what happened with this one?"</p>
    </>
  );
}

export type Tab = "deals" | "check" | "saved" | "you" | "settings";

/**
 * The bottom toolbar.
 *
 * There WAS one, it was removed, and removing it was the wrong call. The
 * original bug was that `.tabs` was `position: absolute` inside a fixed-height
 * fake phone frame, so on a real device it rendered at the end of the scroll
 * content and you had to scroll past 285 listings to reach it. That is a
 * positioning bug, not an argument against bottom navigation, and every mobile
 * app has one for the good reason that the bottom of the screen is where the
 * thumb already is.
 *
 * `position: fixed` with `env(safe-area-inset-bottom)` this time, so it sits
 * above the home indicator rather than under it.
 *
 * FOUR ITEMS, ALL REAL DESTINATIONS. Settings is deliberately NOT among them —
 * it is somewhere you go twice a year, and spending a quarter of the toolbar on
 * it would cost the same room the watchlist needs. It lives in the top bar.
 */
type NavId = "deals" | "check" | "saved";

/**
 * THREE DESTINATIONS. "You" was a primary tab holding four read-only server
 * defaults and the words "Editing these is coming" (audit §13). Its one real
 * number lives under Settings -> Your numbers, so the tab was spending a
 * quarter of the bar on a screen with nothing to do.
 *
 * Three items also give each one more room, which is what the 44px targets in
 * the accessibility pass need.
 */
export const NAV: Array<[NavId, string]> = [
  ["deals", "Deals"], ["check", "Check"], ["saved", "Saved"],
];
export const navIcon = (id: NavId, on: boolean, size: number) =>
  id === "deals" ? <Grid size={size} />
    : id === "check" ? <Scan size={size} />
      : <Save size={size} filled={on} />;

export function Tabbar({ tab, go, savedCount }: {
  tab: NavId | null;
  go: (t: NavId | "settings") => void;
  savedCount: number;
}) {
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map(([id, label]) => (
        <button key={id} className={`tab${tab === id ? " on" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => go(id)}>
          <span className="ti">
            {navIcon(id, tab === id, 21)}
            {id === "saved" && savedCount > 0
              ? <span className="tdot" aria-hidden="true">{savedCount > 9 ? "9+" : savedCount}</span>
              : null}
          </span>
          <span className="tl">{label}</span>
        </button>
      ))}
    </nav>
  );
}


/**
 * "What happened with this one?"
 *
 * Outcomes are the only data in this product that nobody can copy: comps are
 * scraped, listings are public, but what a real buyer DID about a specific
 * verdict exists nowhere else. The buttons for recording it shipped a while
 * ago and the table stayed empty for one reason — nothing ever asked.
 *
 * Four taps, no free text. An outcome you have to write a sentence about is an
 * outcome nobody records.
 *
 * Dismissing counts as asked. Being shown the same question every launch until
 * you answer is how a prompt becomes something people learn to close without
 * reading, and then the honest answers stop too.
 */
export function OutcomePrompt({ h, onDone }: { h: Hist; onDone: () => void }) {
  const [sent, setSent] = useState<string | null>(null);

  const send = (action: string, label: string) => {
    setSent(label);
    markAsked(h.id);
    // Fire and forget: the answer is already recorded locally as asked, and
    // making the user wait on a network round trip to dismiss a prompt is a
    // good way to have them stop answering.
    fetch(`/v1/checks/${h.id}/outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setTimeout(onDone, 900);
  };

  if (sent) {
    return <div className="ask done"><Check size={15} /> {sent}. Thanks — that trains the engine.</div>;
  }

  return (
    <div className="ask">
      <div className="askhead">
        <b>What happened with this one?</b>
        <button className="askx" onClick={() => { markAsked(h.id); onDone(); }} aria-label="Dismiss">×</button>
      </div>
      <span className="asktitle">{h.title}</span>
      <div className="askrow">
        <button onClick={() => send("bought", "Bought")}>I bought it</button>
        <button onClick={() => send("passed", "Passed")}>Passed</button>
        <button onClick={() => send("no_reply", "No reply")}>No reply</button>
        <button onClick={() => send("gone", "Gone")}>Gone</button>
      </div>
    </div>
  );
}

/**
 * The You screen.
 *
 * It was four rows of a key/value table with a paragraph under it — the same
 * treatment a debug dump gets. These numbers are the ones every verdict on the
 * site is computed against, so they are worth stating as a claim rather than a
 * spec sheet.
 *
 * History lives here too. It was rendered on the Check screen where it competed
 * with the paste box; this is where you go to find something you already looked
 * at.
 */
/**
 * A stable per-device ref, used as Stripe's `client_reference_id`.
 *
 * There are no accounts yet, and inventing an email login purely to hang a
 * subscription off would be the largest change on the list for the least
 * benefit. The browser mints a random ref once; Stripe echoes it back on the
 * webhook and that is what the entitlement is keyed on. When real accounts
 * exist this becomes a user id and nothing else changes.
 */
/** Moved to `lib.tsx` — three screens need it now, not just billing. */
export { REFKEY, deviceRef } from "./lib.tsx";

/**
 * Billing.
 *
 * **The server decides whether there is anything to sell.** `enabled` is false
 * until a Stripe price is configured, and the screen then shows the free plan
 * with a real explanation instead of a dead Upgrade button — a control that
 * opens nothing teaches people the whole screen is decorative.
 *
 * `?paid=1` on return from Checkout only triggers a REFRESH. It is never taken
 * as proof of payment; the webhook is the only thing that grants access.
 */
export function Billing({ onlyWhenEnabled }: { onlyWhenEnabled?: boolean }) {
  const [st, setSt] = useState<{ enabled: boolean; plan: string; active?: boolean; until?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/v1/billing/status?ref=${deviceRef()}`).then((r) => r.json()).then(setSt).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    if (new URLSearchParams(location.search).get("paid") === "1") {
      history.replaceState({}, "", "/");
      // The webhook may land a beat after the redirect, so re-check shortly.
      setTimeout(load, 2500);
    }
  }, [load]);

  async function go(path: string) {
    setBusy(true);
    try {
      const r = await (await fetch(`/v1/billing/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: deviceRef() }),
      })).json();
      if (r.url) location.href = r.url;
    } finally { setBusy(false); }
  }

  // Nothing to sell and nothing bought: render nothing at all.
  if (onlyWhenEnabled && st && !st.enabled && !st.active) return null;
  if (onlyWhenEnabled && !st) return null;

  return (
    <div className="sgroup">
      <div className="shead"><Card size={14} /> Billing</div>
      <div className="scard">
        <div className="planrow">
          <div>
            <b>{st?.active ? "Pro" : "Free"}</b>
            <span>
              {st?.active
                ? "Everything in Assyze, including alerts."
                : "Every listing in the feed, unlimited checks, and the daily tracker."}
            </span>
          </div>
          <span className="pill">Current</span>
        </div>

        {!st?.enabled && (
          <p className="snote">
            Assyze is free while the feed is being built out. Paid plans come when there
            is something worth charging for, and nothing you use today moves behind a
            paywall.
          </p>
        )}

        {st?.enabled && !st.active && (
          <button className="btn2" disabled={busy} onClick={() => go("checkout")}>
            <Card size={15} /> {busy ? "Opening…" : "Upgrade"}
          </button>
        )}

        {st?.enabled && st.active && (
          <>
            {st.until && (
              <p className="snote">Renews {new Date(st.until).toLocaleDateString()}.</p>
            )}
            <button className="btn2" disabled={busy} onClick={() => go("portal")}>
              {busy ? "Opening…" : "Manage subscription"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Base64url -> Uint8Array, required by `pushManager.subscribe`.
 *
 * `applicationServerKey` will NOT accept the base64 string the server sends;
 * it wants raw bytes, and passing the string fails with an opaque
 * "InvalidCharacterError" that says nothing about the real problem.
 */


/**
 * Saved searches and push alerts.
 *
 * **THE SUBSCRIPTION IS THE ACCOUNT.** The browser mints a push endpoint only
 * this device can receive on, so a saved search hangs off that instead of a
 * user row. No signup, no password, nothing to leak — and the screen says
 * plainly that alerts belong to this device.
 *
 * Permission is requested from a real tap, never on load. A permission prompt
 * fired on page load is denied by reflex, and on Chrome a denial is sticky
 * enough that the feature is then unreachable without digging through site
 * settings.
 */
export function Alerts() {
  const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [subId, setSubId] = useState<number | null>(() => {
    const v = localStorage.getItem(SUBKEY); return v ? Number(v) : null;
  });
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!subId) return;
    fetch(`/v1/searches?subId=${subId}`).then((r) => r.json())
      .then((d) => setList(d.items ?? [])).catch(() => {});
  }, [subId]);

  async function enable() {
    setBusy(true); setNote(null);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") { setNote("Notifications were blocked. You can undo that in your browser's site settings."); return; }

      const { publicKey, configured } = await (await fetch("/v1/push/vapid")).json();
      if (!configured || !publicKey) { setNote("Push isn't configured on the server yet."); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToBytes(publicKey),
      });
      const r = await (await fetch("/v1/push/subscribe", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })).json();
      if (r.subId) { localStorage.setItem(SUBKEY, String(r.subId)); setSubId(r.subId); }
    } catch (e) {
      setNote(`Couldn't turn on alerts: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function add() {
    const maxCents = max.trim() ? Math.round(Number(max.replace(/[^0-9.]/g, "")) * 100) : null;
    setBusy(true); setNote(null);
    const r = await (await fetch("/v1/searches", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subId, query: q.trim() || null, maxPriceCents: maxCents, label: q.trim() || `Under ${max}` }),
    })).json();
    setBusy(false);
    if (r.error) { setNote(r.error); return; }
    setQ(""); setMax("");
    fetch(`/v1/searches?subId=${subId}`).then((x) => x.json()).then((d) => setList(d.items ?? []));
  }

  async function remove(id: number) {
    await fetch(`/v1/searches/${id}?subId=${subId}`, { method: "DELETE" });
    setList((l) => l.filter((x) => x.id !== id));
  }

  return (
    <div className="sgroup">
      <div className="shead"><Bell size={14} /> Alerts</div>
      <div className="scard">
        {!supported && (
          <p className="snote">
            This browser can't show notifications. Install Assyze to your home screen and open it from there.
          </p>
        )}

        {supported && !subId && (
          <>
            <p className="snote">
              Get told the moment something matching your search posts. This is where the
              feed stops being somewhere you have to remember to check.
            </p>
            <button className="btn2" disabled={busy} onClick={enable}>
              <Bell size={15} /> {busy ? "Turning on…" : "Turn on alerts"}
            </button>
          </>
        )}

        {supported && subId && (
          <>
            {list.map((s) => (
              <div className="srow static" key={s.id}>
                <span className="stext">
                  <b>{s.label}</b>
                  <span>
                    {[s.query && `matches "${s.query}"`,
                      s.max_price_cents && `under ${money(s.max_price_cents)}`]
                      .filter(Boolean).join(" · ") || "any listing"}
                  </span>
                </span>
                <button className="btn3" onClick={() => remove(s.id)}>Remove</button>
              </div>
            ))}

            <div className="srow static newsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="rtx 4090" aria-label="Words to match" />
              <input value={max} onChange={(e) => setMax(e.target.value)}
                placeholder="max $" inputMode="decimal" aria-label="Maximum price" />
              <button className="btn3" disabled={busy || (!q.trim() && !max.trim())} onClick={add}>Add</button>
            </div>

            <p className="snote">
              Every word has to appear in the title, so "rtx 4090" won't alert on every
              graphics card. Alerts only cover listings found after you save the search,
              and they live on this device.
            </p>
            <button className="btn2" onClick={async () => {
              const r = await (await fetch(`/v1/push/test?subId=${subId}`, { method: "POST" })).json();
              setNote(r.sent ? "Sent — check your notifications." : r.error ?? "Couldn't send.");
            }}>Send a test notification</button>
          </>
        )}

        {note && <p className="snote alertnote">{note}</p>}
      </div>
    </div>
  );
}

/** A labelled row with a switch. */
export function Toggle({ label, hint, on, onChange }: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button className="srow" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="stext"><b>{label}</b><span>{hint}</span></span>
      <span className={`sw${on ? " on" : ""}`} aria-hidden="true"><i /></span>
    </button>
  );
}

/**
 * Settings.
 *
 * There was no settings screen at all, which is why "your numbers" ended up on
 * the You tab as a read-only table with "editing these is coming" under it.
 *
 * Only things that DO something are here. A settings screen padded with
 * switches that toggle nothing teaches people the screen is decorative, and
 * then the one that matters gets ignored too. Anything not yet wired says so
 * plainly rather than pretending.
 */
export function SettingsScreen({ s, save, savedCount, onClearSaved }: {
  s: Settings; save: (p: Partial<Settings>) => void;
  savedCount: number; onClearSaved: () => void;
}) {
  const [cleared, setCleared] = useState(false);

  return (
    <div className="screen">
      <div className="feedhead">
        <span className="eyebrow mute">Preferences</span>
        <h1>Your <span className="g">settings</span></h1>
      </div>

      {/**
        * ⚠ BILLING RENDERS ONLY WHEN BILLING IS ENABLED (audit §14).
        *
        * The first Settings card explained that the product is free and paid
        * plans may come later. That is honest but not useful, and it pushed
        * every control that DOES something below the fold. `Billing` already
        * asks the server; it just always rendered the answer.
        */}
      <Billing onlyWhenEnabled />

      <div className="sgroup">
        <div className="shead"><Tag size={14} /> Your numbers</div>
        <div className="scard">
          <label className="srow static">
            <span className="stext">
              <b>Willing to drive</b>
              <span>Longer drives need a bigger margin to be worth it.</span>
            </span>
            {/* The bounds are `nav.ts` constants because the SERVER enforces
                the same 5..90 window. A stepper that offered 120 would move
                this number and silently get a 90-minute verdict back. */}
            <span className="stepper">
              <button aria-label="Less driving time" disabled={s.driveMinutes <= DRIVE_MIN}
                onClick={() => save({ driveMinutes: clampDrive(s.driveMinutes - DRIVE_STEP) })}>−</button>
              <span className="num" aria-live="polite">{s.driveMinutes}m</span>
              <button aria-label="More driving time" disabled={s.driveMinutes >= DRIVE_MAX}
                onClick={() => save({ driveMinutes: clampDrive(s.driveMinutes + DRIVE_STEP) })}>+</button>
            </span>
          </label>
          <p className="snote">
            Your profit floor and hourly rate are set on the server for now. They
            show on the You tab.
          </p>
        </div>
      </div>

      <div className="sgroup">
        <div className="shead"><Grid size={14} /> Feed</div>
        <div className="scard">
          <Toggle label="Hide listings that are gone"
            hint="The daily sweep marks a listing dead when the seller pulls it."
            on={s.hideGone} onChange={(v) => save({ hideGone: v })} />
          <Toggle label="Ask what happened"
            hint="A day after you open a listing, ask if you bought it. This is what teaches the engine."
            on={s.askOutcomes} onChange={(v) => save({ askOutcomes: v })} />
          <Toggle label="Reduce motion"
            hint="Turns off screen and card entry animations."
            on={s.reduceMotion} onChange={(v) => save({ reduceMotion: v })} />
        </div>
      </div>


      <div className="sgroup">
        <div className="shead"><Save size={14} /> Data</div>
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{savedCount} saved {savedCount === 1 ? "listing" : "listings"}</b>
              <span>Stored on this device.</span>
            </span>
            {savedCount > 0 && !cleared && (
              <button className="btn3" onClick={() => { onClearSaved(); setCleared(true); }}>Clear</button>
            )}
            {cleared && <span className="pill">Cleared</span>}
          </div>
        </div>
      </div>

      <p className="micro2">Assyze · assyze.com</p>
    </div>
  );
}

export function You({ hist, onOpen }: { hist: Hist[]; onOpen: (id: number) => void }) {
  const ECON = [
    { k: "Won't leave home for less than", v: "$100", why: "Below this, the drive costs more than the flip makes." },
    { k: "Your time is worth", v: "$125/hr", why: "Used to price the round trip into every verdict." },
    { k: "Based in", v: "Newton, MA", why: "Drive time is measured from here." },
    { k: "Prefer to resell on", v: "Facebook", why: "No fees and no shipping, so local nets more." },
  ];

  return (
    <>
      <div className="youhead">
        <div className="youav" aria-hidden="true"><User size={22} /></div>
        <div>
          <h2>Your numbers</h2>
          <p>Every verdict is computed against these. The same listing is a buy
             for one person and a pass for another.</p>
        </div>
      </div>

      <div className="econ">
        {ECON.map((e) => (
          <div className="econrow" key={e.k}>
            <div className="econk">
              <b>{e.k}</b>
              <span>{e.why}</span>
            </div>
            <div className="econv num">{e.v}</div>
          </div>
        ))}
      </div>

      {hist.length > 0 && (
        <section className="sec">
          <h4>Recently checked <em>({hist.length})</em></h4>
          <div className="histlist">
            {hist.slice(0, 12).map((h) => (
              <button className="histrow" key={h.id} onClick={() => onOpen(h.id)}>
                <span className={`dcall b-${h.call}`}>{LABEL[h.call]}</span>
                <span className="histtitle">{h.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
