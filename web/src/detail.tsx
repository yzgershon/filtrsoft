import { Popup, motionAllowed, type Dismiss } from "./popup.tsx";
/**
 * The listing detail: verdict, numbers, comps, risks and questions.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Alert, Back as BackIcon, Chat, Check, Cut, Eye, Ghost, Info, Link, Shield, Store, Tag,
} from "./icons.tsx";
import type { Channel, Call, Comp, Listing, Meta, Retail, RiskCheck, Signal, Verdict } from "./types.ts";
import { LABEL, ago, toast, Thumb, deviceRef } from "./lib.tsx";
// Seller asks and offer calculations must retain cents, including $17.50 lots.
const money = (c?: number | null) => c == null ? "Unavailable" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Compact, consistent headings inside the detail's information groups.
 * The older icon-topped headings made each fact look like a separate feature;
 * Yish's September 9 brief replaces that treatment with one readable report. */

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
          <h2>{title}</h2>
          {note ? <p className="dnote">{note}</p> : null}
        </div>
        {trailing}
      </div>
    </div>
  );
}

/** One disclosure pattern keeps secondary evidence compact without making it
 * unavailable to keyboard users. Native details also works before hydration. */
function DetailRow({ title, note, icon, children, className = "" }: {
  title: string; note?: React.ReactNode; icon: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return <details className={`detail-row ${className}`}>
    <summary><span className="row-icon">{icon}</span><span className="row-label"><b>{title}</b>{note && <small>{note}</small>}</span><span className="row-chevron" aria-hidden="true" /></summary>
    <div className="row-content">{children}</div>
  </details>;
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
          : "Agree with the assessment or change the label."} />
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

export function Flags({ signals, compact = false }: { signals: Signal[]; compact?: boolean }) {
  if (!signals.length) return null;
  const icon = (s: Signal) =>
    s.polarity === "positive" ? <Check /> : s.severity === "medium" ? <Info /> : <Alert />;
  return (
    <section className="sec rise">
      {!compact && <SecHead tone="risk" icon={<Alert size={18} />} title="Listing concerns"
        note={`${signals.length} observations to check`} />}
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
  const usable = (v.channels ?? []).filter(c => c.available && Number.isFinite(c.netCents));
  const canSwitch = usable.some(c => c.channel === "facebook") && usable.some(c => c.channel === "ebay") && onChannelChange;
  if (val.medianCents == null || v.inventory) return null;
  // Both the overview and calculator use this same selected channel. Never mix
  // the engine's best-channel profit with another channel's fees or proceeds.
  const net = ch && ask != null ? ch.netCents - ask : null;
  const target = ch && v.requiredProfitCents != null ? Math.max(0, ch.netCents - v.requiredProfitCents) : null;
  return <section className="valuation-summary" aria-label="Valuation">
    <div className="value-top"><div><span className="detail-label">Estimated resale value</span>
      <strong className="value-range num">{val.lowCents != null && val.highCents != null ? `${money(val.lowCents)}–${money(val.highCents)}` : money(val.medianCents)}</strong>
      <span className="value-source">{val.compCount} sold comps · {val.confidence} confidence</span>
    </div></div>
    {ch && <div className="resale-channel"><span>Resell {ch.channel === "facebook" ? "locally" : "on eBay"}</span>
      {canSwitch ? <div className="chsw" role="group" aria-label="Resale channel">
        <button aria-pressed={ch.channel === "facebook"} className={ch.channel === "facebook" ? "on" : ""} onClick={() => onChannelChange?.("facebook")}>Local</button>
        <button aria-pressed={ch.channel === "ebay"} className={ch.channel === "ebay" ? "on" : ""} onClick={() => onChannelChange?.("ebay")}>eBay</button>
      </div> : <span className="channel-note">Available channel</span>}
    </div>}
    <dl className="detail-metrics">
      <div><dt>Est. profit at asking</dt><dd className={`num ${net == null ? "" : net > 0 ? "pos" : "neg"}`}>{net == null ? "Unknown" : `${net > 0 ? "+" : ""}${money(net)}`}</dd></div>
      <div><dt>Offer ceiling</dt><dd className="num">{target == null ? "Unknown" : money(target)}</dd></div>
    </dl>
    <DetailRow title="Resale breakdown" note={ch ? "Proceeds, costs and profit target" : "Market estimate only"} icon={<Tag size={17}/>}>
      <dl className="detail-facts">
        <div><dt>Sold-price median</dt><dd className="num">{money(val.medianCents)}</dd></div>
        {ch && <>
          <div><dt>Estimated sale</dt><dd className="num">{money(ch.grossCents)}</dd></div>
          <div><dt>Fees</dt><dd className="num">{money(ch.feesCents)}</dd></div>
          <div><dt>Shipping</dt><dd className="num">{money(ch.shippingCents)}</dd></div>
          <div><dt>Estimated proceeds</dt><dd className="num">{money(ch.netCents)}</dd></div>
        </>}
        <div><dt>Asking price</dt><dd className="num">{money(ask)}</dd></div>
        <div><dt>Required profit</dt><dd className="num">{money(v.requiredProfitCents)}</dd></div>
      </dl>
      <p className="detail-footnote">Offer ceiling leaves room for the required profit. Estimates depend on the item's condition and a completed resale.</p>
      {ch?.note && <p className="detail-footnote">{ch.note}</p>}
    </DetailRow>
  </section>;
}

export function Inventory({ inventory }: { inventory: NonNullable<Verdict["inventory"]> }) {
  return <section className="detail-card inventory-card">
    <SecHead tone="alt" icon={<Tag size={18}/>} title="Item prices" note={`${inventory.offers.length} offers · headline price is a placeholder`}/>
    {inventory.sellerContext && <p className="inventory-context">Seller says: {inventory.sellerContext}</p>}
    <div className="inventory-list">{inventory.offers.map((offer, i) => <article className="inventory-item" key={i}>
      <div className="inventory-item-head"><span className="inventory-quantity num">{offer.quantity}×</span><h3>{offer.item}</h3></div>
      <div className="inventory-price">{offer.askingPriceCents == null ? <span>Conditional pricing</span> : <><strong className="num">{money(offer.askingPriceCents)}</strong><span>{offer.priceBasis === "each" ? "each" : offer.priceBasis === "ambiguous" ? "check price basis" : "for this offer"}</span></>}</div>
      {offer.valuation?.lowCents != null && offer.valuation.highCents != null && <p className="inventory-estimate">Resale {money(offer.valuation.lowCents)}–{money(offer.valuation.highCents)} · {offer.valuation.compCount} sold comps</p>}
      <p className="detail-footnote">{offer.valuationNote}</p>
      <details className="inventory-quote"><summary>Seller's exact wording</summary><blockquote>{offer.evidence}</blockquote></details>
    </article>)}</div>
  </section>;
}

/** Price exploration stays beside the valuation; long comp lists expand only
 * on request. Both use the parent's selected channel and original asking price. */
export function CompsAndOffer({ v, comps, ask, channel: ch }: {
  v: Verdict; comps: Comp[]; ask: number | null; channel?: Channel;
}) {
  const [offer, setOffer] = useState<number | null>(null);
  const at = offer ?? ask ?? 0;
  const net = ch ? ch.netCents - at : null;
  const required = v.requiredProfitCents;
  const available = !!ch && ask != null && required != null && !v.inventory;
  const clears = net != null && required != null && net >= required;
  const max = Math.max(ask ?? 0, 0);
  const step = max % 500 === 0 ? 500 : max % 100 === 0 ? 100 : max % 50 === 0 ? 50 : 1;
  const offerId = useId();
  return <div className="valuation-tools">
    {available && <DetailRow title="Offer calculator" note="Try a different purchase price" icon={<Cut size={17}/> }>
      <div className="offer">
        <div className="offerrow"><label className="offerlbl" htmlFor={offerId}>Your offer</label><span className="num offerval">{money(at)}</span></div>
        <input id={offerId} className="offerslide" type="range" min={0} max={max} step={step} value={at} aria-valuetext={money(at)} onChange={e => setOffer(Number(e.target.value))}/>
        <div className="offer-scale"><span>$0</span><span>{money(max)} asking</span></div>
        <div className={`offerout ${clears ? "ok" : "no"}`} role="status" aria-live="polite">
          {clears ? <Check size={15}/> : <Info size={15}/>}
          <span>Estimated profit <b className="num">{money(net)}</b><small>{ch?.channel === "facebook" ? "Local" : "eBay"} · {clears ? "meets" : "below"} your {money(required)} target</small></span>
        </div>
        {offer != null && offer !== ask && <button className="offerreset" onClick={() => setOffer(null)}>Back to the asking price</button>}
      </div>
    </DetailRow>}
    {comps.length > 0 && <DetailRow title="Sold-price evidence" note={`${v.valuation.compCount} used · ${comps.length} recorded examples`} icon={<Eye size={17}/>}>
      <div className="comps">{comps.map((c, i) => <div className="comp" key={i}>
        <span className="ctitle">{c.raw_title}</span>
        <span className="cmeta">{[c.condition_norm?.replace(/_/g, " "), c.sold_at?.slice(0, 10)].filter(Boolean).join(" · ")}</span>
        <span className="num cprice">{money(c.total)}</span>
      </div>)}</div>
      <p className="detail-footnote">Showing {comps.length} recorded comps. The valuation used {v.valuation.compCount} sold prices.</p>
    </DetailRow>}
  </div>;
}

export function Questions({ qs }: { qs: string[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
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
  const copy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      // A denied clipboard write must never show a successful copied label.
      setCopied(index);
      toast(index === -1 ? `${qs.length} question${qs.length === 1 ? "" : "s"} copied` : "Question copied");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1800);
    } catch { setCopied(null); toast("Couldn't copy", true); }
  };

  return (
    <section className="sec rise">
      <SecHead tone="brand" icon={<Chat size={18} />} title="Ask the seller"
        note={`${qs.length} question${qs.length === 1 ? "" : "s"} before pickup`}
        trailing={
          <button className={`copyall ${copied === -1 ? "ok" : ""}`} onClick={() => void copy(qs.map((q, i) => `${i + 1}. ${q}`).join("\n"), -1)}>
            {copied === -1 ? "Copied" : "Copy all"}
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
              onClick={() => void copy(q, i)}
            >{copied === i ? "Copied" : "Copy"}</button>
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
  const total = Math.min(urls?.length ?? 0, 20);
  const goTo = (next: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: el.clientWidth * next, behavior: motionAllowed() ? "smooth" : "instant" });
  };
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
          <div className="galshot" key={`${n}:${u}`}><ListingPhoto src={u} alt={`Photo ${n + 1} of ${total}`} eager={n===0} open={()=>onOpen(n)}/></div>
        ))}
      </div>
      {urls.length > 1 && (
        <div className="gallery-controls" role="group" aria-label="Listing photos">
          <button aria-label="Previous listing photo" disabled={i === 0} onClick={() => goTo(i - 1)}><BackIcon size={17}/></button>
          <span className="num" aria-live="polite">{i + 1} / {total}</span>
          <button aria-label="Next listing photo" disabled={i === total - 1} onClick={() => goTo(i + 1)}><BackIcon size={17}/></button>
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
      {urls.map((url,i)=><ListingPhoto key={`${i}:${url}`} src={url} alt={`Photo ${i+1} of ${total}`} eager={Math.abs(i-start)<=1}/>)}
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
  listing, verdict, signals, comps, meta, stage, reading, checkId, onBack, onReload, decisionToken,
}: {
  listing: Listing | null; verdict: Verdict | null; signals: Signal[]; comps?: Comp[]; decisionToken?: string;
  meta?: Meta; stage: number; reading: number; checkId?: number | null; onBack?: () => void; onReload?: () => void;
}) {
  const [lbx, setLbx] = useState<number | null>(null);
  const [channelId, setChannelId] = useState("facebook");
  useEffect(() => { setLbx(null); setChannelId("facebook"); }, [listing?.url]);
  const usable = (verdict?.channels ?? []).filter(c => c.available && Number.isFinite(c.netCents));
  const channel = usable.find(c => c.channel === channelId) ?? usable.find(c => c.channel === 'facebook') ?? usable[0];
  if (!listing) return null;
  const src = ({ craigslist: "Craigslist", facebook: "Facebook Marketplace", offerup: "OfferUp", mercari: "Mercari" } as Record<string, string>)[listing.source] ?? listing.source;
  const disclosed = verdict?.riskChecks?.filter(c => c.state === "failed") ?? [];
  const pickup = verdict?.riskChecks?.filter(c => c.state === "unresolved" && !c.remote) ?? [];
  const seriousSignals = signals.filter(s => s.polarity !== "positive" && ["blocker", "high"].includes(s.severity));
  const otherSignals = signals.filter(s => !seriousSignals.includes(s));
  const needsInspection = !!(pickup.length || signals.length || verdict?.questions?.length);
  return <article className="listing-report" key={listing.url}>
    <div className="listing-overview">
      <Gallery key={listing.url} urls={listing.photoUrls ?? []} onOpen={setLbx} onBack={onBack}/>
      {!listing.photoUrls?.length && <div className="detail-no-photo">{onBack && <button className="dback" onClick={onBack} aria-label="Back"><BackIcon size={20}/></button>}<Ghost size={30}/><span>No seller photos</span></div>}
      {lbx !== null && <Lightbox urls={listing.photoUrls} start={lbx} onClose={() => setLbx(null)}/>}
      <div className="lh">
        <div className="listing-source"><span>{src}</span>{meta?.category && <span>{meta.category}</span>}</div>
        <h1>{listing.title}</h1>
        <p className="listing-location">{[listing.location, ago(listing.postedAt)].filter(Boolean).join(" · ")}</p>
        <div className="listing-ask"><div><span className="detail-label">{verdict?.inventory ? "Seller inventory" : "Asking price"}</span><strong className={`price ${verdict?.inventory ? "inventory-ask" : "num"}`}>{verdict?.inventory ? "Priced per item" : listing.askingPriceCents == null ? "Not provided" : money(listing.askingPriceCents)}</strong></div>
          <a className="origin" href={listing.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${src}`}><span>View listing</span><span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </div>

    <div className="decision-card detail-card">
      {verdict ? <>
        <div className={`verdict v-${verdict.call}`}>
          <div className="decision-label"><span className="vbadge">{verdict.call === "BUY" ? <Check size={14}/> : verdict.call === "RISK" ? <Alert size={14}/> : <Info size={14}/>} {LABEL[verdict.call]}</span><span className="decision-owner">{verdict.overriddenFrom ? "Your call" : "Filtrsoft assessment"}</span></div>
          {verdict.overriddenFrom && <p className="engine-original">Engine: {LABEL[verdict.overriddenFrom]}</p>}
          <h2>{verdict.headline}</h2>
          <p className="decision-reasoning">{verdict.reasoning}</p>
          {!!meta?.missingValueFields?.length && <div className="settles"><b>Missing details</b><ul>{meta.missingValueFields.map(field => <li key={field}>{field}</li>)}</ul></div>}
          {verdict.decidingUnknown && <div className="settles"><b>Needs confirmation</b><p>{verdict.decidingUnknown}</p></div>}
        </div>
        {/* Confirmed defects stay ahead of pricing and outside every disclosure. */}
        {disclosed.length > 0 && <div className="disclosed-defects"><h2><Alert size={16}/> Disclosed defects</h2>{disclosed.map(c => <div key={c.code}><b>{c.label}</b>{c.evidence && <p>{c.evidence}</p>}</div>)}</div>}
        {meta?.match?.model && <div className="match-line"><span>{verdict.valuation.medianCents != null ? "Priced as" : "Identified as"}</span><b>{[meta.match.brand, meta.match.model].filter(Boolean).join(" ")}</b><small>{meta.match.confidence} confidence match</small></div>}
        <Numbers v={verdict} ask={listing.askingPriceCents} channel={channel} onChannelChange={setChannelId}/>
        <CompsAndOffer key={listing.url} v={verdict} comps={comps ?? []} ask={listing.askingPriceCents} channel={channel}/>
        {verdict.retail && <DetailRow title="New retail" note={`${money(verdict.retail.priceCents)} · ${verdict.retail.corroborated ? `${verdict.retail.quotes.length} retailers` : "one retailer only"}`} icon={<Store size={17}/>}><p className="detail-footnote">{verdict.retail.title}</p><dl className="detail-facts">{verdict.retail.quotes.map((q,i) => <div key={i}><dt>{q.source}</dt><dd className="num">{money(q.priceCents)}</dd></div>)}</dl><p className="detail-footnote">Observed {verdict.retail.ageDays} days ago. Retail is separate from the used-market estimate.</p></DetailRow>}
      </> : <div className="verdict v-INSUFFICIENT_DATA" aria-busy="true" aria-label="Assessing listing"><div className="skel" style={{height:14,width:100}}/><div className="skel" style={{height:24,marginTop:18}}/><div className="skel" style={{height:60,marginTop:12}}/></div>}
      {reading > 0 && <div className="reading" role="status"><span className="spin" aria-hidden="true"/>Reading {reading} photo{reading === 1 ? "" : "s"}</div>}
      {stage < 3 && <div className="prog" aria-hidden="true">{[0,1,2].map(i => <span className={`step ${stage > i ? "on" : ""}`} key={i}><i/></span>)}</div>}
    </div>

    {verdict?.inventory && <Inventory inventory={verdict.inventory}/>}
    {needsInspection && <div className="detail-card inspection-card">
      {seriousSignals.length > 0 && <Flags signals={seriousSignals}/>}
      {verdict?.questions?.length ? <Questions key={listing.url} qs={verdict.questions}/> : null}
      {pickup.length > 0 && <section className="pickup-section"><SecHead tone="verify" icon={<Shield size={18}/>} title="At pickup" note={`${pickup.length} check${pickup.length === 1 ? "" : "s"} to make in person`}/><ul className="pickup">{pickup.map(c => <li key={c.code}><b>{c.label}</b><span>{c.question}</span></li>)}</ul></section>}
      {otherSignals.length > 0 && <DetailRow title="Listing signals" note={`${otherSignals.length} observation${otherSignals.length === 1 ? "" : "s"} from the listing`} icon={<Info size={17}/>}><Flags signals={otherSignals} compact/></DetailRow>}
    </div>}
    <section className="detail-card listing-record">
      {meta?.description ? <DetailRow title="Seller description" note="Original listing text" icon={<Chat size={17}/>} className="seller-description"><p>{meta.description}</p></DetailRow> : <p className="detail-footnote">No seller description was recorded.</p>}
      <DetailRow title="Listing details" note={`${src} · source and matched model`} icon={<Link size={17}/>}><dl className="detail-facts"><div><dt>Source</dt><dd>{src}</dd></div>{listing.location && <div><dt>Location</dt><dd>{listing.location}</dd></div>}{meta?.daysOnMarket != null && <div><dt>Days listed</dt><dd>{meta.daysOnMarket}</dd></div>}{meta?.match?.model && <div><dt>Matched model</dt><dd>{[meta.match.brand, meta.match.model].filter(Boolean).join(" ")}</dd></div>}{meta?.category && <div><dt>Category</dt><dd>{meta.category}</dd></div>}</dl></DetailRow>
    </section>
    {verdict && checkId && onReload && <div className="detail-card review-card"><MyCall decisionToken={decisionToken} id={checkId} call={verdict.call} overriddenFrom={verdict.overriddenFrom} onChange={onReload}/></div>}
    {/* Outcomes belong on the feed after the trip, never in this decision screen. */}
  </article>;
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
