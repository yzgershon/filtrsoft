import { Popup, motionAllowed, type Dismiss } from "./popup.tsx";
/**
 * The listing detail: verdict, numbers, comps, risks and questions.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Back as BackIcon, Chat, Check, Cut, Eye, Ghost, Info, Link, Shield, Store, Tag,
} from "./icons.tsx";
import type { Channel, Call, Comp, Listing, Meta, Retail, RiskCheck, Signal, Verdict } from "./types.ts";
import { LABEL, money, ago, toast, Thumb, deviceRef } from "./lib.tsx";
import { SectionHead } from "./feed.tsx";

/**
 * A detail-screen section header, in the demo's feature-card language.
 *
 * Yish, 2026-08-31: *"the detail screen's sections should use the demo's
 * icon-topped card treatment."*
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * `.sec h4` was 11px, uppercase, `.12em` tracked and `--ink-3` muted — a micro
 * label, and eight of them in a column read as one undifferentiated list of
 * captions. The demo does the opposite and it is the reason its long pages
 * scan: an icon in an accent colour on top, a bold white title, a muted line of
 * body. You can find the section you want without reading any of them.
 *
 * ⚠ THE ACCENT DESCRIBES WHAT THE SECTION IS, and on THIS screen that includes
 * the verdict hues. The screen-level badges deliberately avoid them (see
 * `.eyebrow` in 08-polish) because a badge in amber would read as a judgement
 * about the whole screen — but "What's wrong with it" is a list of disclosed
 * defects, and painting that green to satisfy a cycling rule would be a rule
 * outranking a meaning.
 *
 * `trailing` exists because three of these headers own a control: the channel
 * switch, "copy all", and the comps disclosure. Putting them anywhere else
 * separates a control from the thing it controls.
 */
export function SecHead({ icon, title, note, tone, trailing }: {
  icon: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
  tone: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={`dhead t-${tone}`}>
      <span className="sicon" aria-hidden="true">{icon}</span>
      {/**
        * ⚠ THE NOTE IS INSIDE `.dtext`, NOT A SIBLING OF `.drow`.
        *
        * As a sibling it sat below the whole row, and the row is as tall as its
        * tallest child — which on "The numbers" is a 44px channel switch. So the
        * subtitle rendered ~30px under its own title, reading as though it
        * belonged to the panel beneath rather than to the heading above.
        */}
      <div className="drow">
        <div className="dtext">
          <h4>{title}</h4>
          {note ? <p className="dnote">{note}</p> : null}
        </div>
        {trailing}
      </div>
    </div>
  );
}

/**
 * His own call, overriding the engine's.
 *
 * Yish, 2026-08-31: *"I noticed some scams were labelled as verify first so I
 * want there to be an option for me to manually change the label of things in
 * the app so I can manually change them to risky."* He had just been sent the
 * same scripted message on two different listings by one seller — the kind of
 * thing a person sees in one exchange and no photo model ever will.
 *
 * ⚠ IT MUST NEVER LOOK LIKE THE ENGINE SAID IT. `overriddenFrom` comes back
 * from the API and the card says "your call, engine said X", because the whole
 * value of the control is knowing which listings you have personally judged.
 * A silent replacement would erase that distinction the moment you forgot.
 *
 * All five priced/risk calls can be reviewed, including agreement with FAIR. "Can't tell" and "Not
 * covered" are things the ENGINE says about its own coverage; a human marking a
 * listing "I couldn't price this" tells nobody anything.
 */
const MY_CALLS: Call[] = ["BUY", "VERIFY", "FAIR", "PASS", "RISK"];

export function MyCall({ id, call, overriddenFrom, onChange,decisionToken }: {
  id: number;
  call: Call;
  overriddenFrom?: Call | null;
  decisionToken?:string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, [id]);
  const [error, setError] = useState(false);
  const set = async (next: Call | null, dismiss: Dismiss) => {
    setError(false);
    setBusy(true);
    try {
      const ref = deviceRef();
      if (next === null) {
        const response = await fetch(`/v1/checks/${id}/override?ref=${encodeURIComponent(ref)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Label was not saved");
        toast("Back to the engine's call");
      } else {
        const response = await fetch(`/v1/checks/${id}/override`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref, call: next,decisionToken }),
        });
        if (!response.ok) throw new Error("Label was not saved");
        toast(`Marked ${LABEL[next]}`);
      }
      if (current.current) dismiss(() => { if (current.current) onChange(); });
    } catch {
      setError(true);
      toast("Couldn't save your review. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <section className="sec rise">
      <SecHead tone="alt" icon={<Eye size={18} />} title="Your call"
        note={overriddenFrom
          ? `You marked this ${LABEL[call]}. The engine said ${LABEL[overriddenFrom]}.`
          : "Agree with this call, or give it your own. Your review shapes the next batch."} />
      <button className="btn2 mycallbtn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {overriddenFrom ? "Change your label" : "Review this listing"}
      </button>
      {open && <Popup title="Your call" subtitle="What's your judgment on this listing?" onClose={() => setOpen(false)}>{dismiss => <>
        <div className="mycall-options" aria-busy={busy}>{MY_CALLS.map(cx => <button key={cx} className={`call-choice b-${cx}`} disabled={busy} aria-pressed={cx === call} onClick={() => set(cx, dismiss)}><span className="call-choice-dot"/><span><b>{LABEL[cx]}</b><small>{cx === "BUY" ? "Worth pursuing" : cx === "VERIFY" ? "Need answers first" : cx === "FAIR" ? "Priced about right" : cx === "PASS" ? "Not worth the trip" : "Something feels wrong"}</small></span><span aria-hidden="true">{cx === call ? "✓" : ""}</span></button>)}</div>
        {error && <p className="popup-error" role="alert">Couldn't save your review. Try again.</p>}
        {overriddenFrom && <button className="popup-footer-link" disabled={busy} onClick={() => set(null, dismiss)}>Use the engine's call</button>}
      </>}</Popup>}

    </section>
  );
}

export function Flags({ signals }: { signals: Signal[] }) {
  if (!signals.length) return null;
  const icon = (s: Signal) =>
    s.polarity === "positive" ? <Check /> : s.severity === "medium" ? <Info /> : <Alert />;
  return (
    <section className="sec rise">
      <SecHead tone="alt" icon={<Info size={18} />} title="What's flagged"
        note={`${signals.length} thing${signals.length === 1 ? "" : "s"} the engine noticed in the listing itself`} />
      <div className="panel">
        {signals.map((s, i) => (
          <div className={`flag f-${s.severity}`} key={i}>
            <span className="dot">{icon(s)}</span>
            <div className="txt">
              <div className="code">{s.code.replace(/_/g, " ")}</div>
              <div className="ev">{s.evidence}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The money, on the channel YOU would actually use.
 *
 * Yish, 2026-08-28: *"I don't like how it is adding cost of fees and shipping
 * when I'm usually buying and selling locally."* He was looking at a gaming PC
 * showing a $183 eBay fee and $15 of shipping on a machine he hands over in a
 * parking lot.
 *
 * Two changes, one in the engine and one here. The engine now treats laptops,
 * consoles and prebuilts as LOCAL-ONLY, so there are no fees to show. And where
 * eBay genuinely is an option — phones, tablets, GPUs, bare components — this
 * screen defaults to **local** and offers a switch, rather than silently
 * picking whichever channel nets more.
 *
 * The switch only renders when there is a real choice. A control that appears
 * with one option is a control that teaches you not to look at it.
 */
export function Numbers({ v, ask, channel: ch, onChannelChange }: { v: Verdict; ask: number | null; channel?: Channel; onChannelChange?: (id:string)=>void }) {
  const val = v.valuation;
  const usable = (v.channels ?? []).filter((c) => c.available);
  const local = usable.find((c) => c.channel === "facebook");
  const shipped = usable.find((c) => c.channel === "ebay");
  const canSwitch = Boolean(local && shipped && onChannelChange);
  if (val.medianCents == null) return null;

  /**
   * Recompute against the SELECTED channel. Reading `v.netProfitCents` would
   * print the engine's best-channel figure next to the other channel's gross,
   * which is a number that belongs to neither.
   */
  const net = ch && ask != null ? ch.netCents - ask : null;
  const target = ch && v.requiredProfitCents != null ? Math.max(0, ch.netCents - v.requiredProfitCents) : null;

  return (
    <section className="sec rise">
      <SecHead tone="buy" icon={<Tag size={18} />} title="The numbers"
        note="what it resells for, and what you keep"
        trailing={canSwitch ? (
          <div className="chsw" role="group" aria-label="Resale channel">
            <button aria-pressed={ch?.channel === "facebook"}
              className={ch?.channel === "facebook" ? "on" : ""} onClick={() => onChannelChange?.("facebook")}>Local</button>
            <button aria-pressed={ch?.channel === "ebay"}
              className={ch?.channel === "ebay" ? "on" : ""} onClick={() => onChannelChange?.("ebay")}>eBay</button>
          </div>
        ) : undefined} />

      <div className="panel">
        <div className="kv">
          <div className="k">Market value<small>{val.compCount} sold comps · {val.confidence} confidence</small></div>
          <div className="v num">{money(val.lowCents)}–{money(val.highCents)}</div>
        </div>

        {ch && (
          <>
            <div className="kv">
              <div className="k">
                {ch.channel === "facebook" ? "Selling locally" : "Selling on eBay"}
                <small>{ch.channel === "facebook" ? "cash, no fees, no shipping" : "after fees and postage"}</small>
              </div>
              <div className="v num">{money(ch.grossCents)}</div>
            </div>
            {ch.feesCents > 0 && <div className="kv sub"><div className="k">fees</div><div className="v num">−{money(ch.feesCents)}</div></div>}
            {ch.shippingCents > 0 && <div className="kv sub"><div className="k">shipping</div><div className="v num">−{money(ch.shippingCents)}</div></div>}
          </>
        )}

        {/* The answer you opened the screen for. Sized like it. */}
        <div className="kv anchor">
          <div className="k">Your profit at asking price</div>
          <div className={`v num ${net == null ? "" : net > 0 ? "pos" : "neg"}`}>{net == null ? "Unavailable" : `${net > 0 ? "+" : ""}${money(net)}`}</div>
        </div>
        <div className="kv quiet">
          <div className="k">You need at least<small>for the drive and the effort</small></div>
          <div className="v num">{money(v.requiredProfitCents)}</div>
        </div>
        {target != null && target > 0 ? (
          <div className="kv hi">
            <div className="k">Offer this or less</div>
            <div className="v num">{money(target)}</div>
          </div>
        ) : null}
      </div>

      {!canSwitch && ch?.channel === "facebook" && (
        <p className="chnote">Local is the available resale channel for this decision.</p>
      )}
    </section>
  );
}

export function Inventory({ inventory }: { inventory: NonNullable<Verdict["inventory"]> }) {
  const quotedMoney = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return (
    <section className="sec rise">
      <SecHead tone="alt" icon={<Tag size={18} />} title="Item prices"
        note="Quoted from the description. The headline price is a placeholder." />
      {inventory.sellerContext && <p>Seller says: {inventory.sellerContext}</p>}
      <div className="panel">
        {inventory.offers.map((offer, i) => (
          <div className="flag" key={i}>
            <div className="txt">
              <strong>{offer.quantity} × {offer.item}</strong>
              <p>{offer.askingPriceCents == null ? "Multiple prices or conditions: check the seller's quote below."
                : `${quotedMoney(offer.askingPriceCents)} ${offer.priceBasis === "each" ? "each" : "for this offer"}`}</p>
              {offer.valuation?.lowCents != null && offer.valuation.highCents != null && (
                <p>Resale: {money(offer.valuation.lowCents)} to {money(offer.valuation.highCents)} · {offer.valuation.compCount} sold comps</p>
              )}
              <p className="ev">{offer.valuationNote}</p>
              <details><summary>Seller's exact wording</summary><p>{offer.evidence}</p></details>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The comps behind the median, and what happens if you offer less.
 *
 * ── WHY BOTH LIVE IN ONE COMPONENT ─────────────────────────────────────────
 *
 * They answer the two halves of the same question. "Where does $2,500 come
 * from" and "what if they won't take my number" are both people refusing to
 * accept one figure on faith, which is the correct instinct.
 *
 * ⚠ THE SLIDER RECOMPUTES IN THE BROWSER AND THAT IS SAFE HERE. Net is
 * `gross - offer`, pure subtraction over numbers the server already sent, so
 * there is no second engine to drift out of sync. Anything that needed the
 * ENGINE — a different drive time, a different channel's fees — goes back to
 * the server, which is why the drive-time control does.
 */
export function CompsAndOffer({ v, comps, ask, channel:ch }: {
  v: Verdict; comps: Comp[]; ask: number | null; channel?: Channel;
}) {
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<number | null>(null);
  const at = offer ?? ask ?? 0;
  const net = ch ? ch.netCents - at : null;
  const required = v.requiredProfitCents;
  const available = !!ch && ask != null && required != null;
  const clears = net != null && required != null && net >= required;
  const target = ch && required != null ? Math.max(0, ch.netCents - required) : null;
  /**
   * ⚠ 0 TO THE ASKING PRICE, AND NOTHING CLEVERER THAN THAT.
   *
   * The first version derived the floor from the economics
   * (`netCents - required * 3`), and on the RTX 4090 that produced min $1,720
   * against max $1,500: an INVERTED RANGE. A range input whose min exceeds its
   * max does not error, it just pins and never moves, so the control rendered
   * perfectly and did nothing. Caught by asserting that dragging it changes
   * the number, which is the only way this was ever going to show up.
   *
   * Offering MORE than they asked is not a thing anyone needs a slider for, so
   * the asking price is the ceiling. $5 steps: fine enough to land on a real
   * number, coarse enough that a drag feels like it is doing something.
   */
  const max = Math.max(ask ?? 0, 0);
  const step = max % 500 === 0 ? 500 : max % 100 === 0 ? 100 : max % 50 === 0 ? 50 : 1;
  const min = 0;

  return (
    <>
      {available && <section className="sec rise">
        <SecHead tone="brand" icon={<Cut size={18} />} title="Offer calculator"
          note={`${ch?.channel === "facebook" ? "Local" : "eBay"} · target ${money(target)}` } />
        <div className="panel offer">
          <div className="offerrow">
            <span className="offerlbl">You offer</span>
            <span className="num offerval">{money(at)}</span>
          </div>
          <input
            className="offerslide" type="range"
            min={min} max={max} step={step} value={at}
            aria-label="Your offer"
            onChange={(e) => setOffer(Number(e.target.value))} />
          <div className={`offerout ${clears ? "ok" : "no"}`} role="status" aria-live="polite">
            {clears
              ? <><Check size={15} /><span>You'd make <b className="num">{money(net)}</b>, which is worth the trip.</span></>
              : <><Info size={15} /><span>You'd make <b className="num">{money(net)}</b>, under the {money(required)} you need.</span></>}
          </div>
          {offer != null && offer !== ask && (
            <button className="offerreset" onClick={() => setOffer(null)}>
              Back to the asking price
            </button>
          )}
        </div>
      </section>}

      {comps.length > 0 && (
        <section className="sec">
          {/**
            * ⚠ COLLAPSED BY DEFAULT AND THAT IS THE POINT. Every number on this
            * screen descends from one median, and the screen used to say "59
            * sold comps" without ever showing one, which asks for trust on the
            * strength of a count. Twelve rows expanded by default would bury the
            * verdict; a disclosure that opens on demand is evidence you can
            * check without being made to read it.
            */}
          <SecHead tone="brand" icon={<Eye size={18} />}
            title={
              <button className="disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
                Sold-price evidence
                <i aria-hidden="true">{open ? "▴" : "▾"}</i>
              </button>
            }
            note={`${v.valuation.compCount} sold comps used for this decision`} />
          {open && (
            <div className="panel comps">
              {comps.map((c, i) => (
                <div className="comp" key={i}>
                  <span className="ctitle">{c.raw_title}</span>
                  <span className="cmeta">
                    {[c.condition_norm?.replace(/_/g, " "), c.sold_at?.slice(0, 10)].filter(Boolean).join(" · ")}
                  </span>
                  <span className="num cprice">{money(c.total)}</span>
                </div>
              ))}
              <p className="compnote">
                The {v.valuation.compCount} sold prices behind this decision.
                Showing {comps.length} recorded comps.
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function Questions({ qs }: { qs: string[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (!qs?.length) return null;
  /**
   * Copy ALL of them, not just one at a time.
   *
   * Codex: "Copy these three questions". The per-question buttons made you
   * paste, switch app, send, come back, and repeat — which is why in practice
   * you ask one question instead of three. The unresolved blockers are already
   * ordered first by `gateQuestions`, so the joined text leads with the one
   * that actually decides it.
   */
  const copyAll = () => {
    navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join("\n"))
      .then(() => toast(`${qs.length} question${qs.length === 1 ? "" : "s"} copied`))
      .catch(() => toast("Couldn't copy", true));
    setCopied(-1);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <section className="sec rise">
      <SecHead tone="brand" icon={<Chat size={18} />} title="Ask the seller"
        note="before you drive anywhere"
        trailing={
          <button className={`copyall ${copied === -1 ? "ok" : ""}`} onClick={copyAll}>
            {copied === -1 ? "copied all" : `copy all ${qs.length}`}
          </button>
        } />
      <div className="panel">
        {qs.map((q, i) => (
          <div className="q" key={i}>
            <span className="n num">{i + 1}</span>
            <span className="t">{q}</span>
            <button
              className={copied === i ? "ok" : ""}
              aria-label={`Copy question ${i + 1}`}
              onClick={() => {
                navigator.clipboard.writeText(q)
                  .then(() => toast("Question copied"))
                  .catch(() => toast("Couldn't copy", true));
                setCopied(i); setTimeout(() => setCopied(null), 1500);
              }}
            >{copied === i ? "copied" : "copy"}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Photo gallery. Swipes horizontally, snaps, and counts.
 *
 * The old version rendered 12 fixed 120x90 thumbnails in a row, which is a
 * contact sheet, not a gallery — on a listing where the specs are in photo 4
 * you could not actually read photo 4. Sellers put the spec sheet, the damage
 * and the serial in the photos; this is the screen where you look at them.
 */
export function ListingPhoto({ src, alt, eager=false, open }: {src:string;alt:string;eager?:boolean;open?:()=>void}) {
  const [failed,setFailed]=useState(false), [attempt,setAttempt]=useState(0);
  useEffect(()=>{setFailed(false);setAttempt(0);},[src]);
  return <div className="listing-photo">
    {failed ? <div className="photo-unavailable"><Ghost size={26}/><span>Photo unavailable</span><button className="btn2" onClick={()=>{setFailed(false);setAttempt(n=>n+1);}}>Retry photo</button></div>
      : open ? <button className="photo-open" onClick={open} aria-label={alt}><img key={attempt} src={src} alt="" loading={eager?"eager":"lazy"} onError={()=>setFailed(true)}/></button>
      : <img key={attempt} src={src} alt={alt} loading={eager?"eager":"lazy"} onError={()=>setFailed(true)}/>}
  </div>;
}

export function Gallery({ urls, onOpen, onBack }: {
  urls: string[]; onOpen: (i: number) => void; onBack?: () => void;
}) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  if (!urls?.length) return null;

  const onScroll = () => {
    const el = ref.current;
    if (!el?.clientWidth) return;
    setI(Math.max(0,Math.min(Math.min(urls.length,20)-1,Math.round(el.scrollLeft / el.clientWidth))));
  };

  return (
    <div className="gal hero-shot">
      {/**
        * ⚠ BACK LIVES ON THE PHOTO, WHICH IS WHERE HE ASKED FOR IT AND WHERE
        * EVERY MARKETPLACE PUTS IT.
        *
        * Yish, 2026-08-31: *"if I click a listing the back button should be an
        * overlayed back arrow on top left of the image."* Before this the only
        * way out was the wordmark, which is Home — a different action that
        * happens to also leave the screen, and it always landed at the top of
        * the feed.
        *
        * It is a SIBLING of the photo buttons, never inside one: `.galshot` is
        * a button and a button inside a button is invalid HTML that browsers
        * resolve by detaching one of them. Same rule as `.gsave` on the card.
        */}
      {onBack && (
        <button className="dback" onClick={onBack} aria-label="Back">
          <BackIcon size={20} />
        </button>
      )}
      <div className="galstrip" ref={ref} onScroll={onScroll}>
        {urls.slice(0, 20).map((u, n) => (
          <div className="galshot" key={u}><ListingPhoto src={u} alt={`Photo ${n + 1} of ${Math.min(urls.length,20)}`} eager={n===0} open={()=>onOpen(n)}/></div>
        ))}
      </div>
      {urls.length > 1 && (
        <div className="galdots" aria-hidden="true">
          <span className="num">{i + 1}/{Math.min(urls.length, 20)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen photo viewer. Escape and a visible close button both dismiss —
 * a lightbox you can only leave by guessing at a gesture is a trap.
 *
 * ── WHAT WAS WRONG WITH IT (audit §16) ─────────────────────────────────────
 *
 * It opened with focus still on the Photo button UNDERNEATH it, Tab walked
 * straight out into the page behind, and closing dropped focus onto the
 * document — so a keyboard user who opened a photo had to tab from the top of
 * the app to get back to where they were. `aria-modal` claimed a trap that did
 * not exist.
 *
 * Three things fix it and all three are load-bearing:
 *
 *   · Focus Close on open, and RESTORE focus to the trigger on close. The
 *     trigger is captured at mount because by the time the effect cleans up,
 *     `document.activeElement` is `<body>`.
 *   · Trap Tab and Shift+Tab across the dialog's own focusables.
 *   · ArrowLeft/ArrowRight move between photos, and the current one is
 *     announced as "Photo 2 of 6" — a strip you can only swipe is a phone-only
 *     control.
 */
export function Lightbox({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  const photos=urls.slice(0,20), total=photos.length;
  return <Popup title="Photos" onClose={onClose} className="photo-popup">{()=> <PhotoStrip urls={photos} start={Math.max(0,Math.min(total-1,start))}/>}</Popup>;
}
function PhotoStrip({urls,start}:{urls:string[];start:number}) {
  const strip=useRef<HTMLDivElement>(null), [at,setAt]=useState(start);
  const total=urls.length;
  const goTo=useCallback((n:number,animate=true)=>{
    const next=Math.max(0,Math.min(total-1,n)); setAt(next);
    const el=strip.current;
    if(el)el.scrollTo({left:el.clientWidth*next,behavior:animate&&motionAllowed()?"smooth":"instant"});
  },[total]);
  useEffect(()=>{goTo(start,false);},[start,goTo]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();goTo(at+(e.key==='ArrowRight'?1:-1));}};
    addEventListener('keydown',key);return()=>removeEventListener('keydown',key);
  },[at,goTo]);
  return <div className="photo-viewer">
    <div className="lbxstrip" ref={strip} onScroll={e=>{const el=e.currentTarget;if(el.clientWidth)setAt(Math.max(0,Math.min(total-1,Math.round(el.scrollLeft/el.clientWidth))));}}>
      {urls.map((url,i)=><ListingPhoto key={url} src={url} alt={`Photo ${i+1} of ${total}`} eager={Math.abs(i-start)<=1}/>)}
    </div>
    <div className="photo-navigation"><button className="btn2" disabled={at===0} onClick={()=>goTo(at-1)} aria-label="Previous photo">‹</button><span className="num" role="status">Photo {at+1} of {total}</span><button className="btn2" disabled={at===total-1} onClick={()=>goTo(at+1)} aria-label="Next photo">›</button></div>
  </div>;
}

/**
 * The hard-blocker panel — the risk layer, finally visible.
 *
 * `riskChecks` has been computed and attached to every verdict for weeks and
 * was rendered nowhere, so the thing that actually separates Filtrsoft from a
 * price lookup was invisible in the product. Each check states what it is,
 * whether the listing resolved it, and the exact question that would.
 */
export function Blockers({ checks }: { checks: RiskCheck[] }) {
  if (!checks?.length) return null;

  /**
   * ⚠ A BLOCKER IS A DISCLOSED DEFECT. AN UNKNOWN IS NOT A BLOCKER.
   *
   * Yish, 2026-08-28: *"I don't like how there are so many hard blockers and
   * most of the time they aren't actually hard blockers... with graphics cards
   * there's always this hard blocker about how it's unknown if the card has
   * display ports... maybe if it mentions that 1 of the HDMI ports is damaged
   * that would be a good example."*
   *
   * He is right, and the codebase already contains the principle: **a check
   * that fires on everything carries no information.** DISPLAY_OUTPUTS was
   * `unresolved` on essentially every graphics card, because you cannot see an
   * I/O bracket from a listing — so the panel screamed HARD BLOCKER at every
   * card in the feed and the label stopped meaning anything.
   *
   * `failed` is the only state that belongs here: the listing SAID something is
   * wrong. Everything else moves:
   *
   *   unresolved + remote    -> a question. Asking costs one message.
   *   unresolved + in person -> a quiet "look at this on pickup" line.
   *   cleared                -> not shown at all. A resolved check is noise.
   *
   * The engine is unchanged — `riskGate` still caps BUY on a remote unknown,
   * which is what stops an activation-locked phone reading as a deal. This is
   * about what is worth SAYING, not about what is enforced.
   */
  const disclosed = checks.filter((c) => c.state === "failed");
  const onPickup = checks.filter((c) => c.state === "unresolved" && !c.remote).slice(0, 2);

  if (!disclosed.length && !onPickup.length) return null;

  return (
    <>
      {disclosed.length > 0 && (
        <section className="sec rise">
          <SecHead tone="risk" icon={<Alert size={18} />} title="What's wrong with it"
            note={`${disclosed.length} the seller stated outright`} />
          <ul className="risks">
            {disclosed.map((c) => (
              <li key={c.code} className="risk r-failed">
                <span className="rstate">stated</span>
                <div>
                  <b>{c.label}</b>
                  {c.evidence && <p>{c.evidence}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onPickup.length > 0 && (
        <section className="sec rise">
          <SecHead tone="verify" icon={<Shield size={18} />} title="Check when you get there"
            note="things a photo cannot settle" />
          <ul className="pickup">
            {onPickup.map((c) => <li key={c.code}>{c.label}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * New retail, when we hold it. The one number on this screen that does NOT
 * come from the comps archive, which is exactly why it is worth showing
 * separately rather than folding into the market range.
 */
export function Ceiling({ r }: { r: Retail }) {
  return (
    <section className="sec rise ceil">
      <SecHead tone="alt" icon={<Store size={18} />} title="New retail"
        note={r.corroborated
          ? `${r.quotes.length} retailers agree`
          : <span className="warn">one retailer only</span>} />
      <div className="ceilrow">
        <span className="num ceilprice">{money(r.priceCents)}</span>
        <span className="ceilwho">{r.quotes.map((q) => `${q.source} ${money(q.priceCents)}`).join(" · ")}</span>
      </div>
      <p className="ceilnote">{r.title}</p>
    </section>
  );
}

/**
 * One-tap outcomes. Codex's highest-leverage small feature.
 *
 * `outcomes` had three rows because nothing ever asked. No free-text form:
 * an outcome you have to write a paragraph about is an outcome nobody records.
 */
export function Outcome({ id }: { id: number }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const OPTS = [
    { a: "bought", label: "I bought it" },
    { a: "passed", label: "Passed" },
    { a: "no_reply", label: "No reply" },
    { a: "dead_listing", label: "Gone" },
  ];
  const send = async (action: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/v1/checks/${id}/outcome`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) setSaved(action);
    } finally { setBusy(false); }
  };

  return (
    <section className="sec rise">
      <h4>What happened?</h4>
      <p className="outnote">
        This records what happened. Only a reported purchase and resale can
        establish what you paid and earned.
      </p>
      <div className="outrow" role="group" aria-label="Record what happened">
        {OPTS.map((o) => (
          <button key={o.a} className={`out ${saved === o.a ? "on" : ""}`}
            disabled={busy || !!saved} aria-pressed={saved === o.a}
            onClick={() => void send(o.a)}>
            {saved === o.a ? <Check size={13} /> : null}{o.label}
          </button>
        ))}
      </div>
      {saved && <p className="outok" role="status">Saved. Thanks — that one actually helps.</p>}
    </section>
  );
}

export function Report({
  listing, verdict, signals, comps, meta, stage, reading, checkId, onBack, onReload,decisionToken,
}: {
  listing: Listing | null; verdict: Verdict | null; signals: Signal[];
  comps?: Comp[];
  decisionToken?:string;
  meta?: Meta; stage: number; reading: number; checkId?: number | null;
  /** Absent during a paste, where the result appears in place and there is
      nothing behind it to go back to. */
  onBack?: () => void;
  /** Re-fetch after he relabels, so the card and the feed agree immediately. */
  onReload?: () => void;
}) {
  const [lbx, setLbx] = useState<number | null>(null);
  const [channelId,setChannelId]=useState("facebook");
  useEffect(()=>{setLbx(null);setChannelId("facebook");},[listing?.url]);
  const usable=(verdict?.channels??[]).filter(c=>c.available && Number.isFinite(c.netCents));
  const channel=usable.find(c=>c.channel===channelId)??usable.find(c=>c.channel==='facebook')??usable[0];
  if (!listing) return null;

  const src = listing.source === "craigslist" ? "Craigslist"
    : listing.source === "facebook" ? "Facebook Marketplace"
    : listing.source === "offerup" ? "OfferUp"
    : listing.source === "mercari" ? "Mercari" : listing.source;

  return (
    <>
      {/**
        * ⚠ `.dtop` IS A PLAIN WRAPPER ON A PHONE AND A TWO-COLUMN GRID FROM
        * 1024px. Photos left, the decision right, and the decision STICKS.
        *
        * On a phone you scroll from the photo down to the verdict, which is
        * correct — there is only one column. On a desktop there is room to have
        * both at once, and "the number next to the picture" is the entire
        * product. Everything that is READING rather than DECIDING — questions,
        * flags, comps, provenance — stays full width below.
        */}
      <div className="dtop">
        <Gallery urls={listing.photoUrls ?? []} onOpen={setLbx} onBack={onBack} />
        {lbx !== null && (
          <Lightbox urls={listing.photoUrls} start={lbx} onClose={() => setLbx(null)} />
        )}

        <div className="dside">
          {/**
            * ⚠ A LISTING WITH NO PHOTOS STILL NEEDS A WAY BACK.
            *
            * `Gallery` returns null on an empty `photoUrls`, and it is the
            * element the overlay arrow is positioned against — so putting Back
            * only there loses it on exactly the listings ZERO_PHOTOS fires on,
            * which are the ones most worth leaving. Same control, in flow.
            */}
          {onBack && !listing.photoUrls?.length && (
            <button className="dback inflow" onClick={onBack} aria-label="Back">
              <BackIcon size={20} />
            </button>
          )}
          <div className="lh rise">
            {/* The listing IS the page here, so its title is the H1. It was an H2
                under no H1 at all, which leaves a screen reader's outline starting
                at level 2 with nothing above it. */}
            <h1>{listing.title}</h1>
            <div className="meta">
              <span className="price num">{verdict?.inventory ? "Item prices below" : money(listing.askingPriceCents)}</span>
              <span className="facts">
                {[listing.location, ago(listing.postedAt)].filter(Boolean).join(" · ")}
              </span>
            </div>

            {/**
              * The link to the original is a PRIMARY action, not a footnote.
              *
              * It was a 12px text link buried under the price. Every path through
              * this screen ends at the real listing — to message the seller, to
              * check the photos again, to see whether it is still up — so it gets
              * a full-width target that says which site it goes to.
              */}
            <a className="origin" href={listing.url} target="_blank" rel="noopener noreferrer">
              <Link size={15} />
              <span>Open on {src}</span>
              <span className="arrow" aria-hidden="true">↗</span>
            </a>
          </div>

          {verdict ? (
            <div className={`verdict verdictcard v-${verdict.call} rise`} role="status" aria-live="polite">
              <span className="vbadge">
                {verdict.call === "BUY" ? <Check size={13} /> : verdict.call === "RISK" ? <Alert size={13} /> : <Info size={13} />}
                {LABEL[verdict.call]}
              </span>
              <h3>{verdict.headline}</h3>
              <p>{verdict.reasoning}</p>
              {!!meta?.missingValueFields?.length && <div className="settles"><b>Missing details:</b> {meta.missingValueFields.join(", ")}</div>}
              {verdict.decidingUnknown && (
                <div className="settles"><b>What settles it:</b> {verdict.decidingUnknown}</div>
              )}
            </div>
          ) : (
            <div className="verdict v-INSUFFICIENT_DATA" aria-busy="true">
              <div className="skel" style={{ height: 12, width: 76, marginBottom: 14 }} />
              <div className="skel" style={{ height: 18, width: "68%", marginBottom: 10 }} />
              <div className="skel" style={{ height: 13, width: "92%", marginBottom: 6 }} />
              <div className="skel" style={{ height: 13, width: "55%" }} />
            </div>
          )}

          {reading > 0 && (
            <div className="reading" role="status" aria-live="polite">
              <span className="spin" aria-hidden="true" />
              Reading {reading} photo{reading === 1 ? "" : "s"} — sellers often put the specs in an image
            </div>
          )}

          {stage < 3 && (
            <div className="prog" aria-hidden="true">
              {[0, 1, 2].map((i) => <span className={`step ${stage > i ? "on" : ""}`} key={i}><i /></span>)}
            </div>
          )}

      {meta?.match?.model && (
        <div className="prov">
          {verdict?.valuation?.medianCents != null ? "Priced as" : "Identified as"} <b>{[meta.match.brand, meta.match.model].filter(Boolean).join(" ")}</b>
          {verdict?.valuation?.compCount
            ? <> from <span className="num">{verdict.valuation.compCount}</span> sold comps</> : null}
          {meta.match.confidence ? <> · {meta.match.confidence} confidence match</> : null}
          {meta.category ? <> · {meta.category}</> : null}
        </div>
      )}
          {verdict && <Numbers v={verdict} ask={listing?.askingPriceCents ?? null} channel={channel} onChannelChange={setChannelId} />}
        </div>
      </div>
      <div className="evidence-grid">
      {meta?.description && <section className="sec"><details className="panel seller-description"><summary>Seller description</summary><p>{meta.description}</p></details></section>}
      {verdict?.inventory && <Inventory inventory={verdict.inventory} />}
      {verdict && (
        <CompsAndOffer key={listing.url} v={verdict} comps={comps ?? []} ask={listing.askingPriceCents} channel={channel} />
      )}
      {verdict?.retail && <Ceiling r={verdict.retail} />}
      {verdict?.riskChecks?.length ? <Blockers checks={verdict.riskChecks} /> : null}
      <Flags signals={signals} />
      {verdict && <Questions qs={verdict.questions} />}
      {/**
        * ⚠ AFTER the engine's reasoning, never before it. This is the place to
        * disagree with a conclusion, and a control to relabel a listing shown
        * above the evidence invites relabelling it without reading any.
        */}
      {verdict && checkId && onReload && (
        <MyCall decisionToken={decisionToken} id={checkId} call={verdict.call} overriddenFrom={verdict.overriddenFrom}
          onChange={onReload} />
      )}
      {/**
        * "What happened?" was REMOVED from the listing view, 2026-08-28.
        *
        * Yish: *"when clicking into a listing I don't want the what happened
        * section at all."* He is right about the placement. You open a listing
        * to decide whether to drive there — being asked what you did about it
        * in the same breath is asking about a trip that has not happened, and
        * it sat between him and the questions he came for.
        *
        * The outcome loop is NOT gone: `OutcomePrompt` still asks on the feed a
        * DAY later, which is when there is something true to answer. That is
        * where the data actually comes from.
        */}

      {/**
        * What the engine THOUGHT this was, shown last.
        *
        * Every wrong verdict this month traced to a wrong match — a network
        * switch read as a Nintendo Switch, an RTX 5070 Ti priced as a 5070, a
        * printer as a prebuilt PC. Printing the resolved model and the comp
        * count makes that visible on the screen where it matters, instead of
        * requiring someone to notice the number looks odd.
        */}
      </div>

    </>
  );
}

// ------------------------------------------------------------------ app
/**
 * The watchlist.
 *
 * It re-fetches current state for the saved ids on every visit rather than
 * rendering what you saw when you saved them. A watchlist that showed the old
 * price would be a screenshot, and the point of saving something is to be told
 * when it changes.
 *
 * The summary line leads because it is the answer to "why did I open this":
 * two dropped, one is gone. That sentence is the whole feature.
 */
