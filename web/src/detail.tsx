import {SpecificationSheet} from "./specifications.tsx";
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
  Alert, Back as BackIcon, Chat, Check, Cut, Eye, Ghost, Info, Link, Shield, Store, Tag, Trash, Clip,
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

export function MyCall({ id, call, overriddenFrom, onChange,decisionToken,compact=false }: {
  id: number;
  compact?: boolean;
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
      {!compact && <SecHead tone="alt" icon={<Eye size={18} />} title="Your call"
        note={overriddenFrom
          ? `You marked this ${LABEL[call]}. The engine said ${LABEL[overriddenFrom]}.`
          : "Agree with the assessment or change the label."} />}
      <button aria-label={overriddenFrom ? "Change your label" : "Review this listing"} className={`btn2 mycallbtn${compact ? " primary-review" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {overriddenFrom ? "Change review" : "Review listing"}
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

  </div>;
}

export function SoldComparisons({comps,count}:{comps:Comp[];count:number}) {
  const [expanded,setExpanded]=useState(false);
  const href=(raw:string|null)=>{try{const u=new URL(raw??'');return ['http:','https:'].includes(u.protocol)&&/(^|\.)ebay\.(?:com|co\.uk|ca|de|com\.au)$/.test(u.hostname)&&/^\/itm\//.test(u.pathname)?u.href:null;}catch{return null;}};
  return <section className="sold-comparisons">
    <header className="tab-section-head"><div><h2>Comparable sales</h2><p>{count} sales used in this valuation</p></div><Eye size={21}/></header>
    {!comps.length && <p className="spec-notice">No individual sold listings were recorded for this decision.</p>}
    <div className="sold-list">{comps.slice(0,expanded?comps.length:3).map((c,i)=>{
      const url=href(c.url),content=<><span className="sold-index num">{String(i+1).padStart(2,'0')}</span><span className="sold-description"><b>{c.raw_title}</b><small>{[c.condition_norm?.replace(/_/g,' '),c.sold_at?.slice(0,10)].filter(Boolean).join(' · ')}</small><span className="sold-market">{url?'eBay · sold listing ↗':'Original sale link unavailable'}</span></span><strong className="num">{money(c.total)}</strong></>;
      return url?<a className="sold-record" href={url} target="_blank" rel="noopener noreferrer" key={i}>{content}</a>:<div className="sold-record" key={i}>{content}</div>;
    })}</div>
    {comps.length>3 && <button className="show-sales" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Show fewer sales':`Show ${comps.length-3} more sales`}<span aria-hidden="true">{expanded?'−':'+'}</span></button>}
    {!!comps.length && <p className="detail-footnote">{comps.length} recorded examples available. Values are the comp totals used by the valuation.</p>}
  </section>;
}

export function Questions({qs}:{qs:string[]}) {
  const [copied,setCopied]=useState(false),[busy,setBusy]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  if(!qs?.length)return null;
  const copy=async()=>{setBusy(true);try{await navigator.clipboard.writeText(qs.map((q,i)=>`${i+1}. ${q}`).join('\n'));setCopied(true);toast('Questions copied');clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1800);}catch{setCopied(false);toast("Couldn't copy. Try again.",true);}finally{setBusy(false);}};
  return <section className="seller-questions">
    <header className="tab-section-head"><div><h2>Ask the seller</h2><p>Resolve these before arranging pickup.</p></div><Chat size={21}/></header>
    <ol>{qs.map((q,i)=><li key={i}><span className="question-number num">{i+1}</span><p>{q}</p></li>)}</ol>
    <button className={`question-copy${copied?' ok':''}`} disabled={busy} onClick={()=>void copy()}><Clip size={17}/>{copied?'Copied':busy?'Copying…':`Copy ${qs.length===1?'question':'questions'}`}</button>
  </section>;
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
      <div className="galstrip" ref={ref} onScroll={onScroll} onKeyDown={e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();goTo(Math.max(0,Math.min(total-1,i+(e.key==="ArrowRight"?1:-1))));}}}>
        {urls.slice(0, 20).map((u, n) => (
          <div className="galshot" key={`${n}:${u}`}><ListingPhoto src={u} alt={`Photo ${n + 1} of ${total}`} eager={n===0} open={()=>onOpen(n)}/></div>
        ))}
      </div>
      {urls.length > 1 && (
        <div className="gallery-count" aria-label={`Photo ${i+1} of ${total}`}><span className="num">{i+1} / {total}</span><span className="gallery-pips" aria-hidden="true">{urls.slice(0,Math.min(total,8)).map((_,n)=><i key={n} className={n===i?'on':''}/>)}</span></div>
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

const DETAIL_TABS=[['decision','Decision'],['specs','Specs'],['evidence','Evidence'],['inspect','Inspect']] as const;
type DetailTab=typeof DETAIL_TABS[number][0];
const initialTab=():DetailTab=>{const t=new URLSearchParams(typeof location==='undefined'?'':location.search).get('tab');return DETAIL_TABS.some(([k])=>k===t)?t as DetailTab:'decision';};
export function Report({listing,verdict,signals,comps=[],meta,stage,reading,checkId,onBack,onReload,decisionToken,onShare,onCompare}:{
  listing:Listing|null;verdict:Verdict|null;signals:Signal[];comps?:Comp[];meta?:Meta;stage:number;reading:number;checkId?:number|null;
  onBack?:()=>void;onReload?:()=>void;decisionToken?:string;onShare?:()=>void;onCompare?:()=>void;
}) {
  const [lbx,setLbx]=useState<number|null>(null),[channelId,setChannelId]=useState('facebook'),[tab,setTab]=useState<DetailTab>(initialTab);
  const [removeOpen,setRemoveOpen]=useState(false),[removed,setRemoved]=useState(!!meta?.dismissed),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const tabs=useRef<HTMLDivElement>(null),prefix=useId();
  useEffect(()=>{setLbx(null);setChannelId('facebook');setTab(initialTab());setRemoveOpen(false);setError('');},[listing?.url]);
  useEffect(()=>setRemoved(!!meta?.dismissed),[checkId,meta?.dismissed]);
  const usable=(verdict?.channels??[]).filter(c=>c.available&&Number.isFinite(c.netCents)),channel=usable.find(c=>c.channel===channelId)??usable.find(c=>c.channel==='facebook')??usable[0];
  const choose=(next:DetailTab)=>{
    setTab(next);const url=new URL(location.href);url.searchParams.set('tab',next);history.replaceState(history.state,'',url);
    requestAnimationFrame(()=>{const el=tabs.current;if(!el?.parentElement)return;const top=document.querySelector('.topbar')?.getBoundingClientRect().height??0;
      // A pinned tab strip reports its sticky position, not the panel's start.
      // Measure the workspace so switching after a long spec sheet reveals the
      // first concern instead of leaving it hidden above the sticky controls.
      window.scrollTo({top:Math.max(0,window.scrollY+el.parentElement.getBoundingClientRect().top-top),behavior:motionAllowed()?'smooth':'instant'});
    });
  };
  const remove=async(value:boolean,dismiss?:Dismiss)=>{if(!checkId)return;setBusy(true);setError('');try{const r=await fetch(`/v1/checks/${checkId}/dismiss`,{method:value?'PUT':'DELETE'});if(!r.ok)throw Error();setRemoved(value);dismiss?.();toast(value?'Removed from your feed':'Listing restored');}catch{setError(value?"Couldn't remove this listing. Try again.":"Couldn't restore this listing. Try again.");}finally{setBusy(false);}};
  if(!listing)return null;
  const src=({craigslist:'Craigslist',facebook:'Facebook Marketplace',offerup:'OfferUp',mercari:'Mercari'} as Record<string,string>)[listing.source]??listing.source;
  const disclosed=verdict?.riskChecks?.filter(c=>c.state==='failed')??[],pickup=verdict?.riskChecks?.filter(c=>c.state==='unresolved'&&!c.remote)??[];
  const concerns=signals.filter(s=>s.polarity!=='positive'),positive=signals.filter(s=>s.polarity==='positive');
  const safeListing=(()=>{try{const u=new URL(listing.url);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}})();
  return <article className="listing-report tabbed-report" key={listing.url}>
    <header className="listing-overview">
      <Gallery key={listing.url} urls={listing.photoUrls??[]} onOpen={setLbx} onBack={onBack}/>
      {!listing.photoUrls?.length&&<div className="detail-no-photo">{onBack&&<button className="dback" onClick={onBack} aria-label="Back"><BackIcon size={20}/></button>}<Ghost size={30}/><span>No seller photos</span></div>}
      {lbx!==null&&<Lightbox urls={listing.photoUrls} start={lbx} onClose={()=>setLbx(null)}/>}
      <div className="lh"><div className="listing-source"><span>{src}</span><span>{listing.location||'Location not stated'}</span></div>
        <h1>{safeListing?<a href={safeListing} target="_blank" rel="noopener noreferrer">{listing.title}<span className="title-external" aria-hidden="true">↗</span></a>:listing.title}</h1>
        <div className="hero-price-row"><strong className={`price ${verdict?.inventory?'inventory-ask':'num'}`}>{verdict?.inventory?'Individual prices':listing.askingPriceCents==null?'Price not stated':money(listing.askingPriceCents)}</strong><span>{ago(listing.postedAt)}</span></div>
        {onCompare&&<button className="detail-compare" onClick={onCompare}><span aria-hidden="true">⇄</span>Compare hardware</button>}
      </div>
    </header>
    {removed&&<div className="removed-notice" role="status"><span>Removed from your feed</span><button disabled={busy} onClick={()=>void remove(false)}>Undo removal</button></div>}
    {error&&!removeOpen&&<p role="alert" className="popup-error">{error}</p>}
    <div className="detail-workspace">
      <div className="detail-tabs" role="tablist" aria-label="Listing information" ref={tabs}>
        {DETAIL_TABS.map(([key,label],i)=><button key={key} id={`${prefix}-${key}-tab`} role="tab" aria-label={label} aria-selected={tab===key} aria-controls={`${prefix}-${key}-panel`} tabIndex={tab===key?0:-1} onClick={()=>choose(key)} onKeyDown={e=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%4;else if(e.key==='ArrowLeft')n=(i+3)%4;else if(e.key==='Home')n=0;else if(e.key==='End')n=3;else return;e.preventDefault();choose(DETAIL_TABS[n][0]);tabs.current?.querySelectorAll('button')[n].focus();}}>{label}{key==='inspect'&&disclosed.length>0&&<i aria-hidden="true" title="Disclosed defects"/>}</button>)}
      </div>
      <div className="detail-panel" id={`${prefix}-decision-panel`} role="tabpanel" aria-labelledby={`${prefix}-decision-tab`} hidden={tab!=='decision'}>
        {verdict?<>
          <section className={`verdict v-${verdict.call}`}><div className="decision-label"><span className="vbadge">{verdict.call==='BUY'?<Check size={14}/>:verdict.call==='RISK'?<Alert size={14}/>:<Info size={14}/>} {LABEL[verdict.call]}</span><span className="decision-owner">{verdict.overriddenFrom?'Your call':'Filtrsoft assessment'}</span></div>
            {verdict.overriddenFrom&&<p className="engine-original">Engine: {LABEL[verdict.overriddenFrom]}</p>}<h2>{verdict.headline}</h2><p>{verdict.reasoning}</p>
            {!!meta?.missingValueFields?.length&&<div className="settles"><b>Missing details</b><p>{meta.missingValueFields.join(' · ')}</p></div>}
            {verdict.decidingUnknown&&<div className="settles"><b>Needs confirmation</b><p>{verdict.decidingUnknown}</p></div>}
            {disclosed.length>0&&<button className="critical-summary" onClick={()=>choose('inspect')}><Alert size={17}/><span>{disclosed.map(c=>c.label).join(' · ')}</span><span aria-hidden="true">↗</span></button>}
          </section>
          {verdict.valuation.medianCents!=null&&!verdict.inventory&&<section className="detail-card money-card"><Numbers v={verdict} ask={listing.askingPriceCents} channel={channel} onChannelChange={setChannelId}/><CompsAndOffer key={listing.url} v={verdict} comps={[]} ask={listing.askingPriceCents} channel={channel}/></section>}
          {meta?.match?.model&&<div className="match-line"><span>Valuation matched to</span><b>{[meta.match.brand,meta.match.model].filter(Boolean).join(' ')}</b><small>{meta.match.confidence} confidence match · specifications are in Specs</small></div>}
          {verdict.inventory&&<Inventory inventory={verdict.inventory}/>}
        </>:<div className="verdict v-INSUFFICIENT_DATA" aria-busy="true"><h2>Assessing listing</h2><div className="skel" style={{height:60}}/></div>}
        {reading>0&&<div className="reading" role="status"><span className="spin"/>Reading {reading} photos</div>}
        {stage<3&&<div className="prog" aria-hidden="true">{[0,1,2].map(i=><span className={`step ${stage>i?'on':''}`} key={i}><i/></span>)}</div>}
      </div>
      <div className="detail-panel" id={`${prefix}-specs-panel`} role="tabpanel" aria-labelledby={`${prefix}-specs-tab`} hidden={tab!=='specs'}><SpecificationSheet specs={meta?.specifications} inventory={!!verdict?.inventory}/></div>
      <div className="detail-panel" id={`${prefix}-evidence-panel`} role="tabpanel" aria-labelledby={`${prefix}-evidence-tab`} hidden={tab!=='evidence'}>
        <SoldComparisons key={listing.url} comps={comps} count={verdict?.valuation.compCount??0}/>
        {meta?.description&&<DetailRow title="Seller description" note="Original listing text" icon={<Chat size={17}/>} className="seller-description"><p>{meta.description}</p></DetailRow>}
        {verdict?.retail&&<DetailRow title="New retail" note={`${money(verdict.retail.priceCents)} · ${verdict.retail.corroborated?'corroborated':'one retailer only'}`} icon={<Store size={17}/>}><p>{verdict.retail.title}</p><dl className="detail-facts">{verdict.retail.quotes.map((q,i)=><div key={i}><dt>{q.source}</dt><dd>{money(q.priceCents)}</dd></div>)}</dl></DetailRow>}
      </div>
      <div className="detail-panel" id={`${prefix}-inspect-panel`} role="tabpanel" aria-labelledby={`${prefix}-inspect-tab`} hidden={tab!=='inspect'}>
        {disclosed.length>0&&<section className="disclosed-defects"><h2><Alert size={17}/> Disclosed defects</h2>{disclosed.map(c=><div key={c.code}><b>{c.label}</b>{c.evidence&&<p>{c.evidence}</p>}</div>)}</section>}
        {!!concerns.length&&<Flags signals={concerns}/>}
        {!!verdict?.questions?.length&&<Questions key={listing.url} qs={verdict.questions}/>}
        {pickup.length>0&&<section className="pickup-section"><header className="tab-section-head"><div><h2>At pickup</h2><p>Check the item in person.</p></div><Shield size={21}/></header><ul className="pickup">{pickup.map(c=><li key={c.code}><b>{c.label}</b><span>{c.question}</span></li>)}</ul></section>}
        {positive.length>0&&<DetailRow title="Positive signals" note={`${positive.length} recorded observations`} icon={<Check size={17}/>}><Flags signals={positive} compact/></DetailRow>}
        {!concerns.length&&!disclosed.length&&!pickup.length&&!verdict?.questions?.length&&<p className="spec-notice">No specific inspection checks were recorded. This does not verify the item's condition.</p>}
      </div>
    </div>
    {verdict&&checkId&&onReload&&<div className="detail-dock"><div className="dock-inner">
      {removed?<button className="btn2 primary-review" disabled={busy} onClick={()=>void remove(false)}>Restore listing</button>:<MyCall compact id={checkId} call={verdict.call} overriddenFrom={verdict.overriddenFrom} decisionToken={decisionToken} onChange={onReload}/>}
      {onShare&&<button className="dock-icon" aria-label="Share listing" onClick={onShare}><Link size={19}/></button>}
      {!removed&&<button className="dock-icon remove-trigger" aria-label="Remove listing" aria-haspopup="dialog" onClick={()=>{setError('');setRemoveOpen(true);}}><Trash size={19}/></button>}
    </div></div>}
    {removeOpen&&<Popup title="Remove listing" subtitle="Hide it from your feed, saved listings and alerts. You can restore it in Settings." onClose={()=>setRemoveOpen(false)}>{dismiss=><div className="remove-confirm"><button className="remove-confirm-button" disabled={busy} onClick={()=>void remove(true,dismiss)}>{busy?'Removing…':'Remove from my feed'}</button><button className="btn2" disabled={busy} onClick={()=>dismiss()}>Keep listing</button>{error&&<p className="popup-error" role="alert">{error}</p>}</div>}</Popup>}
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
