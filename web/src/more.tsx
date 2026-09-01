/**
 * More — the fourth tab — plus the two screens that hang off the top bar.
 *
 * ⚠ WHY A HUB AND NOT JUST SETTINGS. Yish, 2026-09-01: *"the settings button
 * will move to the taskbar at the bottom and instead of it just being the
 * settings button it will change to a more button where settings will be one
 * of the options along with other options."*
 *
 * The rule from the Settings rebuild carries over and is the only thing
 * keeping this screen honest: **every row goes somewhere that already works.**
 * A More screen is the easiest place in an app to park eight rows of
 * aspiration, and the moment two of them do nothing the other six stop being
 * read. Three of these rows are things that EXISTED but were buried — Alerts
 * and Purchases were sub-tabs of Saved, and the check history was a block at
 * the bottom of the Check screen — so this is mostly a promotion, not an
 * invention.
 */
import { useEffect, useState } from "react";
import {
  Alert, Bell, Card, Check, Clock, Gear, Ghost, Grid, Info, Save, Scan,
  Shield, Star, Store, Tag, User,
} from "./icons.tsx";
import type { Hist } from "./types.ts";
import {
  LABEL, money, readNotes, markNotesSeen, onNotes, type Note,
  deviceRef, Thumb, toast,
} from "./lib.tsx";

/** One tappable row in the hub. */
function Row({ icon, label, hint, badge, onClick }: {
  icon: React.ReactNode; label: string; hint: string;
  badge?: number; onClick: () => void;
}) {
  return (
    <button className="mrow" onClick={onClick}>
      <span className="mic" aria-hidden="true">{icon}</span>
      <span className="mtext">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      {badge ? <span className="mbadge num">{badge > 99 ? "99+" : badge}</span> : null}
      <span className="mchev" aria-hidden="true">›</span>
    </button>
  );
}

export function MoreScreen({ go, savedCount, noteCount }: {
  go: (p: string) => void;
  savedCount: number;
  noteCount: number;
}) {
  /**
   * ⚠ THE PURCHASE COUNT IS FETCHED HERE RATHER THAN THREADED THROUGH `App`.
   * The shell has no reason to know about purchases, and passing a placeholder
   * down would print a badge that is right only when it happens to be zero.
   */
  const [bought, setBought] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/v1/purchases?ref=${deviceRef()}`)
      .then((r) => r.json())
      .then((d) => setBought(Array.isArray(d.items) ? d.items.length : 0))
      .catch(() => setBought(null));
  }, []);

  return (
    <div className="screen">
      <div className="feedhead tight">
        <h1>More</h1>
      </div>

      {/*
        * ── YOUR STUFF ────────────────────────────────────────────────────
        * Everything tied to this account/device, and the three rows that were
        * previously reachable only by knowing a sub-tab existed.
        */}
      <div className="sgroup">
        <div className="shead"><User size={14} /> You</div>
        <div className="scard">
          <Row icon={<User size={17} />} label="Account"
            hint="Who you are on this device, and your plan."
            onClick={() => go("/account")} />
          <Row icon={<Bell size={17} />} label="Notifications"
            hint="Deals that landed while you were away."
            badge={noteCount}
            onClick={() => go("/notifications")} />
          <Row icon={<Store size={17} />} label="Purchases"
            hint="What you bought, and what it made."
            badge={bought ?? 0}
            onClick={() => go("/saved?sub=purchases")} />
          <Row icon={<Save size={17} />} label="Saved listings"
            hint="Re-checked daily for price drops and disappearances."
            badge={savedCount}
            onClick={() => go("/saved")} />
        </div>
      </div>

      {/*
        * ── FINDING DEALS ─────────────────────────────────────────────────
        */}
      <div className="sgroup">
        <div className="shead"><Scan size={14} /> Finding deals</div>
        <div className="scard">
          <Row icon={<Alert size={17} />} label="Alerts"
            hint="Saved searches that push you when something matches."
            onClick={() => go("/saved?sub=alerts")} />
          <Row icon={<Clock size={17} />} label="Recently checked"
            hint="Every listing you've opened."
            onClick={() => go("/check")} />
          <Row icon={<Tag size={17} />} label="Your numbers"
            hint="Drive time and the profit floor every verdict is measured against."
            onClick={() => go("/settings")} />
        </div>
      </div>

      {/*
        * ── APP ───────────────────────────────────────────────────────────
        */}
      <div className="sgroup">
        <div className="shead"><Gear size={14} /> App</div>
        <div className="scard">
          <Row icon={<Gear size={17} />} label="Settings"
            hint="Alerts, the feed, appearance, data and privacy."
            onClick={() => go("/settings")} />
          <Row icon={<Star size={17} />} label="Plan"
            hint="What you're on and what else there is."
            onClick={() => go("/settings")} />
          <Row icon={<Info size={17} />} label="How Assyze works"
            hint="Where the prices come from and what each verdict means."
            onClick={() => go("/how")} />
        </div>
      </div>

      <p className="micro2">Assyze · assyze.com</p>
    </div>
  );
}

/**
 * Notifications.
 *
 * ⚠ THIS IS THE BANNER'S MEMORY, AND WITHOUT IT THE ALERT WAS WRITE-ONLY. The
 * banner shows for nine seconds; a BUY that landed while the phone was face
 * down was announced to an empty room. At 0.7 BUYs a day that is most of them.
 *
 * ⚠ THE VERDICT SHOWN IS THE ONE THAT FIRED, not the one the listing has now.
 * Re-reading every row on this screen would be four requests to say something
 * the detail screen says properly on tap, and a re-score between the alert and
 * the visit would silently rewrite history. The timestamp is what makes that
 * honest: it says when this was true.
 */
export function NotificationsScreen({ onOpen }: { onOpen: (id: number) => void }) {
  const [notes, setNotes] = useState<Note[]>(readNotes);

  useEffect(() => onNotes(setNotes), []);
  /**
   * Marked seen on ARRIVAL at the screen, not on tapping a row. Getting here
   * is the act of reading them; requiring a tap on each would leave the bell
   * lit over a list he has already been through.
   */
  useEffect(() => { setNotes(markNotesSeen()); }, []);

  return (
    <div className="screen">
      <div className="feedhead tight">
        <h1>Notifications</h1>
        <p>
          {notes.length
            ? "Deals the crawler found while you had the app open."
            : "Nothing yet."}
        </p>
      </div>

      {!notes.length ? (
        <div className="empty">
          <span className="eic"><Bell size={26} /></span>
          <b>No alerts yet</b>
          <p>
            When a Buy it lands while Assyze is open, it shows at the top of the
            screen and is kept here. That happens about five times a week, so
            this list stays short on purpose.
          </p>
        </div>
      ) : (
        <div className="scard">
          {notes.map((n) => (
            <button className="nrow" key={`${n.id}-${n.at}`} onClick={() => onOpen(n.id)}>
              <span className="nshot">
                {n.thumb ? <Thumb src={n.thumb} /> : <Ghost size={16} />}
              </span>
              <span className="ntext">
                <span className={`nkick b-${n.call}`}>
                  <i aria-hidden="true" />{LABEL[n.call]}
                  <em>{when(n.at)}</em>
                </span>
                <b>{n.title}</b>
              </span>
              {n.askingPriceCents != null && (
                <span className="nprice num">{money(n.askingPriceCents)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "3m", "4h", "2d" — short, because it sits inside a one-line kicker. */
function when(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Account.
 *
 * ⚠ TODAY THIS IS THE DEVICE, AND IT SAYS SO PLAINLY. There are no logins yet,
 * so the honest thing is to name what actually holds his saved listings, his
 * verdict overrides and his plan — the device ref — rather than draw an empty
 * avatar and a "Sign in" button that does nothing. When accounts land, the
 * identity at the top of this screen changes and the rows below it do not.
 */
export function AccountScreen({ go, savedCount }: {
  go: (p: string) => void; savedCount: number;
}) {
  const [plan, setPlan] = useState<{ plan: string; owner?: boolean } | null>(null);
  const ref = deviceRef();

  useEffect(() => {
    fetch(`/v1/billing/status?ref=${ref}`).then((r) => r.json()).then(setPlan).catch(() => {});
  }, [ref]);

  const planName = plan?.owner ? "Founder" : plan?.plan === "pro" ? "Pro" : "Free";

  return (
    <div className="screen">
      <div className="feedhead tight">
        <h1>Account</h1>
      </div>

      <div className="acchead">
        <div className="accav" aria-hidden="true"><User size={26} /></div>
        <div className="accid">
          <b>This device</b>
          <span className="mono">{ref.slice(0, 10)}…{ref.slice(-4)}</span>
        </div>
        <span className={`pill${plan?.owner || plan?.plan === "pro" ? " on" : ""}`}>{planName}</span>
      </div>

      <div className="sgroup">
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{savedCount} saved {savedCount === 1 ? "listing" : "listings"}</b>
              <span>Held against this device ID.</span>
            </span>
          </div>
          <button className="srow" onClick={() => {
            navigator.clipboard?.writeText(ref)
              .then(() => toast("Device ID copied"))
              .catch(() => toast("Couldn't copy", true));
          }}>
            <span className="stext">
              <b>Copy device ID</b>
              <span>Keep it before you clear browser data.</span>
            </span>
            <Card size={15} />
          </button>
        </div>
        <p className="snote">
          There is no sign-in yet. Your saved listings, the verdicts you
          relabelled and your plan all belong to this device. Nothing to leak and
          nothing to remember, and nothing that follows you to another phone.
        </p>
      </div>

      <div className="sgroup">
        <div className="scard">
          <Row icon={<Star size={17} />} label="Plan"
            hint={`You're on ${planName}.`} onClick={() => go("/settings")} />
          <Row icon={<Shield size={17} />} label="Privacy"
            hint="What Assyze stores and what it never touches."
            onClick={() => go("/settings")} />
        </div>
      </div>
    </div>
  );
}

/**
 * How Assyze works.
 *
 * ⚠ THE NUMBERS HERE ARE READ FROM THE SERVER, NOT TYPED IN. An explainer that
 * hardcodes "18,000 sold prices" is wrong the first week and nobody notices,
 * and this screen's entire job is to make the verdicts believable. If the
 * request fails the sentence loses its number rather than inventing one.
 */
export function HowScreen() {
  const [h, setH] = useState<{ comps?: number; skus?: number } | null>(null);
  useEffect(() => {
    fetch("/v1/health").then((r) => r.json()).then(setH).catch(() => {});
  }, []);
  const n = (v?: number) => (typeof v === "number" ? v.toLocaleString() : null);

  const STEPS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
    {
      icon: <Scan size={18} />,
      title: "It reads the listing",
      body: "Title, description and every photo, to work out what the thing actually is: the exact GPU, the exact CPU, how much RAM and storage.",
    },
    {
      icon: <Tag size={18} />,
      title: "It prices it against real sales",
      body: n(h?.comps)
        ? `Not asking prices. ${n(h?.comps)} completed eBay sales across ${n(h?.skus)} models, which is what the thing is worth rather than what someone hoped for.`
        : "Not asking prices. Completed eBay sales, which is what the thing is worth rather than what someone hoped for.",
    },
    {
      icon: <Alert size={18} />,
      title: "It looks for the ways it goes wrong",
      body: "Stock photos, a price that is too good, a seller pushing you off-platform, a GPU with no display outputs. Anything that fails a hard check can never be a Buy it.",
    },
    {
      icon: <Grid size={18} />,
      title: "It subtracts your costs",
      body: "Fees, shipping and the drive. A deal is only a deal after the round trip is paid for, so the verdict is what you actually clear.",
    },
  ];

  const CALLS: Array<{ call: keyof typeof LABEL; body: string }> = [
    { call: "BUY", body: "Priced, checked, and clears your floor. Go." },
    { call: "VERIFY", body: "One question stands between this and a Buy it. The app writes the message for you." },
    { call: "RISK", body: "Something failed a scam check. Kept out of the main feed on purpose." },
    { call: "FAIR", body: "Correctly priced. Nothing in it for you." },
    { call: "PASS", body: "Above what it is worth." },
    { call: "INSUFFICIENT_DATA", body: "Not enough stated to price it honestly. Assyze would rather say so than guess." },
  ];

  return (
    <div className="screen">
      <div className="feedhead tight">
        <h1>How Assyze works</h1>
        <p>Four steps between a listing and a verdict.</p>
      </div>

      <div className="hsteps">
        {STEPS.map((s, i) => (
          <div className="hstep" key={s.title}>
            <span className="hnum" aria-hidden="true">{i + 1}</span>
            <div>
              <b>{s.title}</b>
              <p>{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="sgroup">
        <div className="shead"><Check size={14} /> What each verdict means</div>
        <div className="scard">
          {CALLS.map((c) => (
            <div className="srow static" key={c.call}>
              <span className="stext">
                <b><span className={`dcall b-${c.call}`}>{LABEL[c.call]}</span></b>
                <span>{c.body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="micro2">Assyze · assyze.com</p>
    </div>
  );
}
