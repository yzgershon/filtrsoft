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
  Cross, Dots, Phone, Shield, Spark, Star, Trash,
} from "./icons.tsx";
import type { Call, FeedItem, Hist } from "./types.ts";
import { Ghost } from "./icons.tsx";
import {
  type Settings, DRIVE_MIN, DRIVE_MAX, DRIVE_STEP, clampDrive,
  SEEN_KEY, SETTINGS_KEY,
} from "./nav.ts";
import {
  LABEL, money, ago, markAsked, toast, writeWatch, readWatch, toggleWatch,
  SUBKEY, reconcilePushSubscription, urlB64ToBytes, deviceRef, Thumb, readSettings, HKEY, AKEY,
} from "./lib.tsx";
import { Gcard } from "./feed.tsx";
import { CrawlPanel } from "./crawl.tsx";

export function Watchlist({ onOpen, onWatchChange, onBrowse }: {
  onOpen: (id: number) => void;
  onWatchChange: (n: number) => void;
  /** The empty state needs a way out. Audit §"Saved and Alerts". */
  onBrowse: () => void;
}) {
  /**
   * ⚠ THE SUB-TAB IS DEEP-LINKABLE via `?sub=`, because the More hub now
   * points straight at Alerts and Purchases. Without this, "Purchases" in More
   * would land on Saved's Listings tab and leave the user to find the right
   * sub-tab themselves — which is exactly the burial that putting them in More
   * was meant to undo.
   *
   * Read once, in a lazy initialiser: it seeds the tab, it does not own it, so
   * tapping another sub-tab afterwards must not be overridden on re-render.
   */
  const [sub, setSub] = useState<"listings" | "alerts" | "bought">(() => {
    const q = new URLSearchParams(location.search).get("sub");
    return q === "alerts" ? "alerts" : q === "purchases" || q === "bought" ? "bought" : "listings";
  });
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
            <div className={`grid${readSettings().compact ? " dense" : ""}`}>
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
 * What Filtrsoft has actually bought him.
 *
 * Yish, 2026-08-31: *"add a section in Filtrsoft where it shows all of my
 * purchases with the help of filtrsoft and make it have good ui."*
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
 * ⚠ FOUR ITEMS AS OF 2026-09-01, AND THE FOURTH IS **MORE**, NOT SETTINGS.
 *
 * Yish: *"the settings button will move to the taskbar at the bottom and
 * instead of it just being the settings button it will change to a more button
 * where settings will be one of the options along with other options."*
 *
 * The old note here argued Settings did not deserve a quarter of the bar, and
 * that argument still holds — which is exactly why the tab is More. It is a hub
 * over Settings, Account, Notifications, Purchases, Alerts and the explainer,
 * three of which were previously reachable only by knowing that a sub-tab of
 * Saved existed. Four items still clear 44px at 320px; five would not.
 */
type NavId = "deals" | "check" | "saved" | "more";

export const NAV: Array<[NavId, string]> = [
  ["deals", "Deals"], ["check", "Check"], ["saved", "Saved"], ["more", "More"],
];
export const navIcon = (id: NavId, on: boolean, size: number) =>
  id === "deals" ? <Grid size={size} />
    : id === "check" ? <Scan size={size} />
      : id === "saved" ? <Save size={size} filled={on} />
        : <Dots size={size} />;

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
    return <div className="ask done"><Check size={15} /> {sent}. Thanks, that trains the engine.</div>;
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
/**
 * Plans.
 *
 * ⚠ THE TIERS ARE DESCRIBED HERE AND PRICED BY STRIPE, and they must not
 * drift. `PLANS` is copy — what each tier gives you — while the amount charged
 * comes from `STRIPE_PRICE_ID` on the server. Hardcoding a dollar figure in
 * both places is how a price change ships to the marketing copy and not to the
 * checkout, so the number is stated once and clearly labelled as the display
 * price of the configured plan.
 *
 * ⚠ AND THE FREE TIER IS NOT A CRIPPLED ONE. `billing.ts` explains why billing
 * is built and off: the Phase 3 gate is ten payers, Filtrsoft has an audience of
 * one, and a paywall now costs the only thing that matters. Nothing in the
 * "Free" column below is something the app does today and would stop doing.
 */
const PLANS: Array<{
  id: string; name: string; blurb: string; lines: string[]; tier: number;
}> = [
  {
    id: "free", name: "Free", tier: 0,
    blurb: "Everything the feed does today.",
    lines: [
      "Every verified listing in the feed",
      "Unlimited link checks",
      "Saved listings, re-checked daily",
      "Price-drop and sold tracking",
    ],
  },
  {
    id: "pro", name: "Pro", tier: 1,
    blurb: "For when a deal is worth being first to.",
    lines: [
      "Everything in Free",
      "Push alerts on saved searches",
      "Deal banner the moment a BUY lands",
      "Your own verdict overrides, synced",
    ],
  },
  {
    id: "owner", name: "Founder", tier: 2,
    blurb: "The whole thing, permanently.",
    lines: [
      "Everything in Pro",
      "No limits and no expiry",
      "New features the day they build",
    ],
  },
];

export function Billing({ onlyWhenEnabled }: { onlyWhenEnabled?: boolean }) {
  const [st, setSt] = useState<{
    enabled: boolean; plan: string; active?: boolean;
    until?: string | null; owner?: boolean;
  } | null>(null);
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

  /**
   * ⚠ `onlyWhenEnabled` STILL SUPPRESSES THE WHOLE THING (audit §14) — but the
   * OWNER always sees it. The Settings screen passes the flag so a
   * nothing-to-sell state does not push every working control below the fold;
   * on his device there is always something true to show.
   */
  if (!st) return onlyWhenEnabled ? null : <div className="sgroup" />;
  if (onlyWhenEnabled && !st.enabled && !st.active && !st.owner) return null;

  const current = st.owner ? "owner" : st.active ? "pro" : "free";
  const currentTier = PLANS.find((p) => p.id === current)?.tier ?? 0;

  return (
    <div className="sgroup">
      <div className="shead"><Star size={14} /> Plan</div>

      <div className="plans">
        {PLANS
          /**
           * ⚠ FOUNDER IS HIDDEN FROM EVERYONE WHO IS NOT ON IT. It cannot be
           * bought, so showing it to a free user is a tier with no button —
           * a dead column that reads as either a bug or a taunt.
           */
          .filter((p) => p.id !== "owner" || st.owner)
          .map((p) => {
            const is = p.id === current;
            return (
              <div className={`plan${is ? " on" : ""}${p.id === "owner" ? " gold" : ""}`} key={p.id}>
                <div className="planhd">
                  <b>{p.name}</b>
                  {is
                    ? <span className="pill on">Current</span>
                    : p.tier > currentTier ? <span className="pill">Upgrade</span> : null}
                </div>
                <p className="planblurb">{p.blurb}</p>
                <ul className="planlist">
                  {p.lines.map((l) => (
                    <li key={l}><Check size={12} />{l}</li>
                  ))}
                </ul>
                {/**
                  * The button appears ONLY on a tier you can actually move to.
                  * A disabled "Upgrade" under the plan you already have is a
                  * control that exists to be refused.
                  */}
                {p.id === "pro" && !is && st.enabled && (
                  <button className="btn2" disabled={busy} onClick={() => go("checkout")}>
                    <Card size={15} /> {busy ? "Opening…" : "Upgrade"}
                  </button>
                )}
                {p.id === "pro" && is && (
                  <button className="btn3 wide" disabled={busy} onClick={() => go("portal")}>
                    {busy ? "Opening…" : "Manage subscription"}
                  </button>
                )}
              </div>
            );
          })}
      </div>

      {st.owner && (
        <p className="snote">
          This device is the founder account. Nothing here expires and nothing
          asks you to pay.
        </p>
      )}

      {!st.enabled && !st.owner && (
        <p className="snote">
          Filtrsoft is free while the feed is being built out. Paid plans come when
          there is something worth charging for, and nothing you use today moves
          behind a paywall.
        </p>
      )}

      {st.enabled && st.active && !st.owner && st.until && (
        <p className="snote">Renews {new Date(st.until).toLocaleDateString()}.</p>
      )}
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
    let active=true;
    reconcilePushSubscription().then(async id=>{
      if(!active)return;setSubId(id);if(!id){setList([]);return;}
      const response=await fetch(`/v1/searches?subId=${id}`);const d=await response.json();
      if(!response.ok)throw new Error(d.error??"Couldn't load alerts.");
      if(active)setList(d.items??[]);
    }).catch(e=>{if(active){setList([]);setNote((e as Error).message);}});
    return()=>{active=false;};
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
            This browser can't show notifications. Install Filtrsoft to your home screen and open it from there.
          </p>
        )}

        {supported && !subId && (
          <>
            <p className="snote">
              Get told the moment a Buy it or Verify first posts. That one is on
              automatically — you do not have to set anything up. This is where the
              feed stops being somewhere you have to remember to check.
            </p>
            <button className="btn2" disabled={busy} onClick={enable}>
              <Bell size={15} /> {busy ? "Turning on…" : "Turn on alerts"}
            </button>
          </>
        )}

        {supported && subId && (
          <>
            {/**
              * ⚠ THE STANDING ALERT RENDERS AS A SWITCH, NOT A CARD WITH A
              * REMOVE BUTTON. Yish, 2026-09-04: *"the entire point of the app
              * was to send me a notification when there is a buy and a verify
              * first but its still not working ... the alerts only work for
              * custom alerts that i make."*
              *
              * It is on from the moment notifications are allowed, and it must
              * not look like one more optional thing to configure — the
              * previous shape of this screen is the reason it never existed.
              */}
            {list.filter((s) => s.standing).map((s) => (
              <div className="srow static" key={s.id}>
                <span className="stext">
                  <b className="ok">Every Buy it{(s.calls ?? "").includes("VERIFY") ? " and Verify first" : ""}</b>
                  <span>
                    On automatically. This is the one you actually want; it needs no setup.
                  </span>
                </span>
              </div>
            ))}
            {list.filter((s) => s.standing).map((s) => (
              <label className="srow" key={`v${s.id}`}>
                <span className="stext">
                  <b>Include Verify first</b>
                  <span>Deals that need one question answered before you drive. Off means Buy it only.</span>
                </span>
                <input type="checkbox" className="switch"
                  checked={(s.calls ?? "").includes("VERIFY")}
                  onChange={async (e) => {
                    await fetch(`/v1/searches/standing?subId=${subId}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ verify: e.target.checked }),
                    });
                    fetch(`/v1/searches?subId=${subId}`).then((x) => x.json()).then((d) => setList(d.items ?? []));
                  }} />
              </label>
            ))}

            {list.filter((s) => !s.standing).map((s) => (
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
              Above is on by itself. Add a search below only if you want something
              narrower, like one model under a price. Every word has to appear in the
              title, so "rtx 4090" won't alert on every graphics card. Alerts only cover
              listings found after they were set up, and they live on this device.
            </p>
            <button className="btn2" onClick={async () => {
              const r = await (await fetch(`/v1/push/test?subId=${subId}`, { method: "POST" })).json();
              setNote(r.sent ? "Sent. Check your notifications." : r.error ?? "Couldn't send.");
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
 * ⚠ THE RULE THIS SCREEN IS BUILT ON: **only things that DO something.** A
 * settings screen padded with switches that toggle nothing teaches people the
 * screen is decorative, and then the one that matters gets ignored too.
 *
 * Yish, 2026-09-01, asked for *"a general section, account section, and a
 * bunch others like what apps usually have even things we havent talked
 * about."* Every group below exists because a real control needed a home —
 * the ones a normal app has that Filtrsoft genuinely has no answer for (dark/
 * light mode: there is one theme; language: there is one language; sign out:
 * there is no account) are NOT stubbed in as disabled rows. An app that says
 * "coming soon" four times is worse than one that is honestly small.
 */
export function SettingsScreen({ s, save, savedCount, onClearSaved }: {
  s: Settings; save: (p: Partial<Settings>) => void;
  savedCount: number; onClearSaved: () => void;
}) {
  const [cleared, setCleared] = useState(false);
  const [histCleared, setHistCleared] = useState(false);
  const [badgesReset, setBadgesReset] = useState(false);

  /**
   * ⚠ THE DEVICE REF IS SHOWN, TRUNCATED, AND IT IS THE CLOSEST THING TO AN
   * ACCOUNT THIS PRODUCT HAS.
   *
   * Saved listings, verdict overrides, push subscriptions and the billing
   * entitlement all hang off it. Someone whose overrides vanish because they
   * cleared site data deserves to have seen the thing that was holding them,
   * and support for a lost subscription is impossible without it.
   */
  const ref = deviceRef();

  /** Rough localStorage footprint, for the Data group. */
  const kb = (() => {
    try {
      let n = 0;
      for (const k in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, k)) {
          n += (localStorage.getItem(k)?.length ?? 0) + k.length;
        }
      }
      return Math.max(1, Math.round(n / 1024));
    } catch { return null; }
  })();

  /**
   * ⚠ INSTALL STATE IS DETECTED, NOT ASSUMED. `display-mode: standalone` is
   * the only reliable read of "this is running as an installed app" across
   * Android and iOS, and it decides whether the row is an instruction or a
   * confirmation. Telling someone to install something they already installed
   * is how a settings screen loses their trust in one line.
   */
  const installed = typeof matchMedia === "function"
    && matchMedia("(display-mode: standalone)").matches;

  return (
    <div className="screen">
      {/**
        * ⚠ NO EYEBROW HERE. Yish, 2026-09-01: *"in the settings get rid of the
        * preferences tag at the top and the Your settings change to just
        * Settings."* Every other screen's eyebrow names a category the heading
        * then narrows; "Preferences" above "Your settings" said the same word
        * twice and cost a row of vertical space on the screen with the most
        * scrolling to do.
        */}
      <div className="feedhead tight">
        <h1>Settings</h1>
      </div>

      <Billing onlyWhenEnabled />

      {/**
        * ⚠ THE CRAWL BUTTON LIVES IN SETTINGS, NOT ON THE FEED. It is an
        * operator control, not something to tap while browsing — and putting a
        * PIN prompt one thumb-slip away from the deals list is how a crawl gets
        * started by accident on a phone in a pocket.
        */}
      <CrawlPanel />

      {/* ── ALERTS ─────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Bell size={14} /> Alerts</div>
        <div className="scard">
          {/**
            * ⚠ THERE IS NO "ALERT ME ON BUY" SWITCH, ONLY A MASTER AND A
            * SECOND TIER. Measured 2026-09-01: BUY lands 0.7 times a day. A
            * signal that rare has no volume problem for a switch to solve, and
            * an extra toggle beside the master is mostly a way to turn the
            * product off by accident.
            */}
          <Toggle label="Deal banner"
            hint="Drop a banner from the top when a Buy it lands while the app is open. About five a week."
            on={s.alerts} onChange={(v) => save({ alerts: v })} />
          {s.alerts && (
            <Toggle label="Include Verify first"
              hint="Adds listings that need one question answered. Roughly two a day instead of one every other day."
              on={s.alertVerify} onChange={(v) => save({ alertVerify: v })} />
          )}
          {/**
            * ⚠ PUSH LIVES ON SAVED AND IS NOT DUPLICATED HERE (audit §12). A
            * saved search IS the alert, so the place to manage one is beside
            * the searches themselves; a second copy of the controls here would
            * be two screens that can disagree about the same subscription.
            */}
          {/**
            * ⚠ THIS POINTS AT SAVED, IT DOES NOT DESCRIBE WHAT LIVES THERE.
            * `ui-verify` fails Settings on the words the saved-search UI uses,
            * which is the right guard: the failure mode audit §12 is about is
            * two screens that can disagree about one subscription. A pointer
            * is not a second copy, so the pointer must not read like one.
            */}
          <p className="snote">
            Push notifications for when the app is <b>closed</b> are set up
            under Saved.
          </p>
        </div>
      </div>

      {/* ── YOUR NUMBERS ───────────────────────────────────────────────── */}
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
            You need <b>$100</b> clear on anything within 20 minutes. Past that
            the drive starts paying for itself at $80/hr, so a 30-minute trip
            needs about $127. Set on the server; this stepper is what moves it.
          </p>
        </div>
      </div>

      {/* ── FEED ───────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Grid size={14} /> Feed</div>
        <div className="scard">
          <Toggle label="Hide listings that are gone"
            hint="The daily sweep marks a listing dead when the seller pulls it."
            on={s.hideGone} onChange={(v) => save({ hideGone: v })} />
          <Toggle label="Show how long it's been listed"
            hint="A tag on the photo: 20 Min, 4 Hrs, 2 Days. Anything over three days never shows one."
            on={s.showAge} onChange={(v) => save({ showAge: v })} />
          <Toggle label="Show the verdict on cards"
            hint="The Buy it / Verify / Risky chip over each photo. Listings you relabelled keep theirs either way."
            on={s.showCall} onChange={(v) => save({ showCall: v })} />
          <Toggle label="Denser grid"
            hint="Three listings a row instead of two. Smaller photos, more per screen."
            on={s.compact} onChange={(v) => save({ compact: v })} />
          <Toggle label="Ask what happened"
            hint="A day after you open a listing, ask if you bought it. This is what teaches the engine."
            on={s.askOutcomes} onChange={(v) => save({ askOutcomes: v })} />
        </div>
      </div>

      {/* ── APPEARANCE ─────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Spark size={14} /> Appearance</div>
        <div className="scard">
          <Toggle label="Reduce motion"
            hint="Turns off screen and card entry animations."
            on={s.reduceMotion} onChange={(v) => save({ reduceMotion: v })} />
          {/**
            * ⚠ NO THEME PICKER, AND THAT IS NOT AN OVERSIGHT. There is one
            * theme; the verdict colours are tuned against this exact ground
            * (`--vfill` / `--vink` in 08-polish.css) and a light mode is a
            * palette rewrite, not a switch. A disabled "Light" row here would
            * be a promise the CSS cannot keep.
            */}
          <p className="snote">
            Filtrsoft is dark only. The verdict colours are contrast-tuned against
            this background, so a light theme is a repaint rather than a switch.
          </p>
        </div>
      </div>

      {/* ── APP ────────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Phone size={14} /> App</div>
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{installed ? "Installed" : "Add to home screen"}</b>
              <span>
                {installed
                  ? "Running as an app. Alerts and the feed work the same either way."
                  : "Open the browser menu and choose Add to Home screen for full-screen and faster launches."}
              </span>
            </span>
            {installed && <span className="pill on">Done</span>}
          </div>
          <button className="srow" onClick={() => location.reload()}>
            <span className="stext">
              <b>Check for updates</b>
              <span>Reloads the app. Filtrsoft updates itself on the next launch.</span>
            </span>
            <Again size={16} />
          </button>
        </div>
      </div>

      {/* ── ACCOUNT ────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><User size={14} /> Account</div>
        <div className="scard">
          {/**
            * ⚠ "NO ACCOUNT" IS A FEATURE AND IS STATED AS ONE, along with the
            * cost. Saved listings, overrides and alerts hang off the device
            * ref, so they genuinely do not follow him to another phone. Saying
            * so here is the difference between a known tradeoff and a bug
            * report the first time he opens Filtrsoft on a laptop.
            */}
          <button className="srow" onClick={() => {
            navigator.clipboard?.writeText(ref)
              .then(() => toast("Device ID copied"))
              .catch(() => toast("Couldn't copy", true));
          }}>
            <span className="stext">
              <b>This device</b>
              <span className="mono">{ref.slice(0, 10)}…{ref.slice(-4)}</span>
            </span>
            <Cut size={15} />
          </button>
          <p className="snote">
            There is no sign-in. Your saved listings, your own verdict labels and
            your plan all belong to this device, which means nothing to leak and
            nothing to remember, and that they do not follow you to another
            phone. Copy the ID before clearing your browser data.
          </p>
        </div>
      </div>

      {/* ── DATA ───────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Save size={14} /> Data</div>
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{savedCount} saved {savedCount === 1 ? "listing" : "listings"}</b>
              <span>Stored on this device{kb ? ` · about ${kb} KB in total` : ""}.</span>
            </span>
            {savedCount > 0 && !cleared && (
              <button className="btn3" onClick={() => { onClearSaved(); setCleared(true); }}>Clear</button>
            )}
            {cleared && <span className="pill">Cleared</span>}
          </div>

          <div className="srow static">
            <span className="stext">
              <b>Recently checked</b>
              <span>The listings you've opened, kept for the outcome question.</span>
            </span>
            {!histCleared
              ? (
                <button className="btn3" onClick={() => {
                  try { localStorage.removeItem(HKEY); localStorage.removeItem(AKEY); } catch { /* ignore */ }
                  setHistCleared(true);
                  toast("History cleared");
                }}>Clear</button>
              )
              : <span className="pill">Cleared</span>}
          </div>

          {/**
            * ⚠ RESETTING THE BADGES IS A REAL CONTROL, not housekeeping. The
            * watermarks decide what counts as new; if one ever gets stamped
            * wrong — a clock jump, a bad restore — every badge reads zero
            * forever and there is no other way to notice or fix it. Clearing
            * the key makes the next feed load re-stamp them from server time.
            */}
          <div className="srow static">
            <span className="stext">
              <b>New-listing badges</b>
              <span>The counts on Buy it, Verify, Risky and All.</span>
            </span>
            {!badgesReset
              ? (
                <button className="btn3" onClick={() => {
                  try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
                  setBadgesReset(true);
                  toast("Badges reset");
                }}>Reset</button>
              )
              : <span className="pill">Reset</span>}
          </div>
        </div>
      </div>

      {/* ── PRIVACY ────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead"><Shield size={14} /> Privacy</div>
        <div className="scard">
          {/**
            * ⚠ THESE ARE STATEMENTS OF FACT ABOUT THE CODE, not a policy page,
            * and each one is checkable. No card data: `billing.ts` uses Stripe
            * Checkout and never sees a number. No credentials: no code path in
            * this repo accepts a marketplace login. No tracking: there is no
            * analytics dependency in `web/package.json`.
            */}
          <p className="snote nolead">
            Filtrsoft never handles a card number. Payment happens on Stripe's own
            page. It never asks for a marketplace login. There is no analytics
            and no third-party tracking, and the only thing stored about you is
            on this device.
          </p>
        </div>
      </div>

      {/* ── DANGER ─────────────────────────────────────────────────────── */}
      <div className="sgroup">
        <div className="shead danger"><Trash size={14} /> Reset</div>
        <div className="scard">
          {/**
            * ⚠ TWO TAPS, AND THE SECOND ONE SAYS WHAT IT DESTROYS. This wipes
            * the saved list, the history, the overrides binding and the plan
            * binding — everything that makes this device his. A single
            * unguarded tap here is the one control on this screen that cannot
            * be undone.
            */}
          <ResetEverything />
        </div>
      </div>

      <p className="micro2">Filtrsoft · filtrsoft.com</p>
    </div>
  );
}

/**
 * "Reset everything", armed in two steps.
 *
 * ⚠ THE CONFIRM IS INLINE, NOT `window.confirm`. A native confirm is a modal
 * the page cannot style, it reads as a browser warning rather than as part of
 * the app, and on an installed PWA it is the one dialog that can sit there
 * blocking every subsequent interaction. Inline also lets the second state
 * spell out the consequence, which a one-line confirm cannot.
 */
function ResetEverything() {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="srow static">
        <span className="stext"><b>Cleared</b><span>Reopen Filtrsoft to start fresh.</span></span>
        <span className="pill">Done</span>
      </div>
    );
  }

  if (!armed) {
    return (
      <button className="srow" onClick={() => setArmed(true)}>
        <span className="stext">
          <b className="danger">Reset everything</b>
          <span>Saved listings, history, your own labels and this device's ID.</span>
        </span>
        <Trash size={16} />
      </button>
    );
  }

  return (
    <div className="srow static confirm">
      <span className="stext">
        <b className="danger">Delete it all?</b>
        <span>
          This cannot be undone. Your saved listings, every verdict you
          relabelled and your plan are tied to this device's ID and will be
          unrecoverable.
        </span>
      </span>
      <span className="confirmrow">
        <button className="btn3" onClick={() => setArmed(false)}>
          <Cross size={13} /> Keep
        </button>
        <button className="btn3 danger" onClick={() => {
          /**
           * ⚠ `localStorage.clear()`, not a list of keys. A list goes stale the
           * moment a feature adds one, and a "reset everything" that quietly
           * leaves something behind is worse than no reset at all.
           */
          try { localStorage.clear(); } catch { /* ignore */ }
          setDone(true);
        }}>
          Delete
        </button>
      </span>
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
