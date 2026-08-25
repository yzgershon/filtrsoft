/**
 * bun run review            build docs/testset/review.html and open it
 * bun run review --import <file.json>   load revised grades back in
 *
 * WHY THIS EXISTS. `bun run score` reads 1/10 and the disagreements are no
 * longer logic errors — they are VALUATION disputes. The engine says a 1TB
 * iPhone 16 Pro Max at $750 is a PASS because the market median is $799 and
 * eBay takes 13.25%; Yish graded it BUY. One of those is wrong and the repo
 * cannot tell which, because the 69 judgments were made from a mental model of
 * market value BEFORE a single real comp existed.
 *
 * So this shows both sides at once: the listing, the engine's arithmetic, and
 * the actual sold comps underneath it. Re-grading with the evidence visible is
 * the fastest way to find out whether the comps are low or the grades were
 * optimistic — and it is a question only Yish can answer.
 *
 * The page is a STANDALONE FILE with the data embedded. No server, no fetch, so
 * it keeps working when the API is not running and can be opened from anywhere.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkStored } from "../engine/index.ts";
import { storageOf } from "../valuation/index.ts";
import { adjustPrice, normalizeCondition, comparable } from "../valuation/condition.ts";
import { db, now } from "../db/index.ts";

const OUT = join(import.meta.dir, "../../docs/testset/review.html");

/** Audit-tool ref -> ingested listing title fragment. Mirrors score.ts. */
const MAP: Record<string, string> = {
  gamingpc650: "i7-6700K",
  teslap100: "Tesla P100",
  zfold5: "Z fold 5",
  iphone16pm: "iPhone 16 Pro Max",
  imac5k: "A2115",
  nzxt750: "SPECS IN PICTURES",
  iphone15cam: "iphone 15 128GB",
  latitude7420: "Latitude 7420",
  iphone15pm: "Unlocked iphone 15 Pro Max",
  zflip6: "Z Flip 6",
};

// ---------------------------------------------------------------- import
const importAt = process.argv.indexOf("--import");
if (importAt >= 0) {
  const path = process.argv[importAt + 1];
  if (!path) { console.error("--import needs a file path"); process.exit(1); }
  const revised = JSON.parse(readFileSync(path, "utf8")) as Array<{
    ref: string; call: string; notes?: string;
  }>;
  const ins = db().prepare(
    `INSERT INTO judgments (listing_id, external_ref, engine_call, human_call, agreement, notes, judged_by, created_at)
     VALUES (NULL,$ref,$eng,$human,$agree,$notes,'yish-rereview',$now)`,
  );
  let n = 0;
  for (const r of revised) {
    if (!r.ref || !r.call) continue;
    // A re-review is a NEW judgment row, never an overwrite. The original grade
    // and the grade-with-evidence are both data, and which one moved is the
    // interesting part.
    ins.run({
      $ref: r.ref, $eng: null, $human: r.call, $agree: null,
      $notes: r.notes ?? null, $now: now(),
    });
    n++;
  }
  console.log(`imported ${n} revised grades as judged_by='yish-rereview'`);
  console.log("The originals are untouched — run `bun run score` to see the effect.");
  process.exit(0);
}

// ---------------------------------------------------------------- build
interface Row {
  ref: string; title: string; url: string; askingCents: number | null;
  location: string | null; photos: string[];
  human: string; humanNotes: string | null;
  engine: string; headline: string; reasoning: string;
  valuation: any; netProfitCents: number | null; requiredProfitCents: number | null;
  bestChannel: any; riskChecks: any[]; questions: string[];
  sku: string | null; storageGb: number | null; usedCount: number; targetCond: string;
  comps: Array<{ p: number; c: string; t: string; sold: string | null; used: boolean; adj: number; salvage: boolean }>;
}

const rows: Row[] = [];

for (const [ref, frag] of Object.entries(MAP)) {
  const j = db().query(
    `SELECT human_call, notes FROM judgments WHERE external_ref=$r AND judged_by='yish' ORDER BY id DESC LIMIT 1`,
  ).get({ $r: ref }) as { human_call: string; notes: string | null } | null;

  const l = db().query(
    `SELECT id, title, url, asking_price_cents, location FROM listings WHERE title LIKE $f ORDER BY id DESC LIMIT 1`,
  ).get({ $f: `%${frag}%` }) as any;
  if (!j || !l) continue;

  const v = db().query(
    `SELECT payload FROM verdicts WHERE listing_id=$id ORDER BY id DESC LIMIT 1`,
  ).get({ $id: l.id }) as { payload: string } | null;
  const verdict = v ? JSON.parse(v.payload) : null;
  void verdict;

  const photos = (db().query(
    `SELECT url FROM listing_photos WHERE listing_id=$id ORDER BY position LIMIT 4`,
  ).all({ $id: l.id }) as Array<{ url: string }>).map((p) => p.url);

  /**
   * Re-run the pipeline to recover the MATCH.
   *
   * The stored `verdicts.payload` is a `VerdictResult`, which deliberately does
   * not carry the match — so `verdict.match.skuId` was undefined and every case
   * rendered with zero comps, i.e. with exactly the evidence this page exists to
   * show. `checkStored` re-scores from stored data and returns both.
   */
  const scored = checkStored(l.id);
  const skuId = scored.match.skuId ?? null;
  const sku = skuId
    ? (db().query(`SELECT brand || ' ' || model AS n FROM skus WHERE id=$id`).get({ $id: skuId }) as any)?.n ?? null
    : null;
  const rawComps = skuId
    ? (db().query(
        `SELECT sold_price_cents p, condition_norm c, raw_title t, sold_at sold
         FROM comps WHERE sku_id=$id ORDER BY sold_price_cents`,
      ).all({ $id: skuId }) as any[])
    : [];

  /**
   * Mark which comps actually FED the median.
   *
   * `valueSku` drops comps stating a different storage tier, so an iPhone 16
   * Pro Max 1TB priced off 10 comps was being shown next to all 63 for that
   * SKU. Anyone reading the page would have tried to reconcile a $799 median
   * against a $300-$1300 spread and concluded the engine was broken.
   */
  const wantGb = scored.match.attributes?.storage_gb;
  /**
   * Show the CONDITION-ADJUSTED price beside the raw one.
   *
   * The 1TB comps had a raw median of $870 while the valuation said $799,
   * because new and refurb sales are restated as used-equivalent before the
   * median is taken. Showing only raw prices next to a different headline
   * number would have manufactured a second mystery to replace the one this
   * page exists to settle.
   */
  const targetCond = normalizeCondition(String(scored.match.attributes.condition ?? "")) ?? "used";
  const cat = scored.match.category ?? scored.signals.category;
  const comps = rawComps.map((c) => ({
    ...c,
    adj: adjustPrice(c.p, normalizeCondition(c.c), targetCond, cat),
    salvage: !comparable(normalizeCondition(c.c), targetCond),
    used: typeof wantGb === "number" && wantGb >= 64
      ? (() => { const g = storageOf(c.t); return g === null || Math.abs(g - wantGb) / wantGb < 0.2; })()
      : true,
  }));
  const usedCount = comps.filter((c) => c.used && !c.salvage).length;

  rows.push({
    ref, title: l.title, url: l.url, askingCents: l.asking_price_cents,
    location: l.location, photos,
    human: j.human_call, humanNotes: j.notes,
    // Freshly scored, not the stored row — the page must never show a call the
    // current engine would not produce.
    engine: scored.verdict.call,
    headline: scored.verdict.headline,
    reasoning: scored.verdict.reasoning,
    valuation: scored.verdict.valuation ?? null,
    netProfitCents: scored.verdict.netProfitCents ?? null,
    requiredProfitCents: scored.verdict.requiredProfitCents ?? null,
    bestChannel: scored.verdict.bestChannel ?? null,
    riskChecks: scored.verdict.riskChecks ?? [],
    questions: scored.verdict.questions ?? [],
    sku, comps, usedCount,
    storageGb: typeof wantGb === "number" ? wantGb : null,
    targetCond,
  });
}

const CALLS = ["BUY", "FAIR", "VERIFY", "PASS", "RISK", "INSUFFICIENT_DATA"];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assyze — re-review with evidence</title>
<style>
  :root{
    --bg:#0d0b0b; --card:#161313; --line:#2a2525; --ink:#f2eeec; --dim:#9a908c;
    --buy:#33d17a; --fair:#8ab4f8; --verify:#f5c344; --pass:#8a8078; --risk:#ff6b5e;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}
  header{position:sticky;top:0;z-index:10;background:rgba(13,11,11,.94);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:16px 22px;
    display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  h1{font-size:17px;margin:0;letter-spacing:-.01em}
  .sub{color:var(--dim);font-size:13px}
  .wrap{max-width:1080px;margin:0 auto;padding:22px}
  .case{background:var(--card);border:1px solid var(--line);border-radius:14px;
    padding:20px;margin-bottom:22px}
  .top{display:flex;gap:18px;flex-wrap:wrap}
  .shots{display:flex;gap:6px;flex:0 0 auto}
  .shots img{width:74px;height:74px;object-fit:cover;border-radius:8px;
    border:1px solid var(--line);background:#000}
  .meta{flex:1;min-width:260px}
  .title{font-weight:620;font-size:16px;margin:0 0 4px}
  .title a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}
  .price{font-variant-numeric:tabular-nums;font-size:21px;font-weight:680}
  .calls{display:flex;gap:22px;margin:16px 0 6px;flex-wrap:wrap}
  .call{font-weight:680;letter-spacing:.02em}
  .lbl{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.09em;
    display:block;margin-bottom:2px}
  .BUY{color:var(--buy)} .FAIR{color:var(--fair)} .VERIFY{color:var(--verify)}
  .PASS{color:var(--pass)} .RISK{color:var(--risk)} .INSUFFICIENT_DATA{color:var(--dim)}
  .box{background:#100e0e;border:1px solid var(--line);border-radius:10px;
    padding:14px;margin-top:14px}
  .box h3{margin:0 0 8px;font-size:11px;color:var(--dim);text-transform:uppercase;
    letter-spacing:.09em;font-weight:600}
  .math{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,Consolas,monospace;
    font-size:13px;line-height:1.85}
  .math .n{color:var(--ink);font-weight:600}
  .neg{color:var(--risk)} .pos{color:var(--buy)}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:4px 8px 4px 0;border-bottom:1px solid #201c1c;vertical-align:top}
  td.p{font-variant-numeric:tabular-nums;text-align:right;width:66px;font-weight:600}
  td.c{width:78px;color:var(--dim)} td.d{width:82px;color:var(--dim);font-size:11.5px}
  .more{color:var(--dim);font-size:12px;margin-top:8px;cursor:pointer;
    background:none;border:0;padding:0;text-decoration:underline}
  .risks{display:flex;flex-direction:column;gap:6px;font-size:13px}
  .risks .r{display:flex;gap:8px;align-items:baseline}
  .st{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;flex:0 0 auto}
  .resolved{background:#12331f;color:var(--buy)}
  .unresolved{background:#3a2f10;color:var(--verify)}
  .failed{background:#3a1714;color:var(--risk)}
  .grade{margin-top:16px;padding-top:16px;border-top:1px dashed var(--line)}
  .btns{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}
  .btns button{background:#1d1919;border:1px solid var(--line);color:var(--ink);
    border-radius:8px;padding:7px 13px;font-size:13px;cursor:pointer;font-weight:600}
  .btns button:hover{border-color:#463d3d}
  .btns button[aria-pressed=true]{background:var(--ink);color:#0d0b0b;border-color:var(--ink)}
  textarea{width:100%;background:#100e0e;border:1px solid var(--line);color:var(--ink);
    border-radius:8px;padding:10px;font:inherit;font-size:13px;resize:vertical;min-height:52px}
  .note{color:var(--dim);font-size:12.5px;font-style:italic;margin-top:6px}
  .bar{display:flex;gap:10px;margin-left:auto}
  .bar button{background:var(--ink);color:#0d0b0b;border:0;border-radius:8px;
    padding:9px 15px;font-weight:680;cursor:pointer;font-size:13px}
  .bar button.ghost{background:transparent;color:var(--dim);border:1px solid var(--line)}
  .empty{color:var(--dim);font-style:italic;font-size:13px}
</style></head><body>
<header>
  <div>
    <h1>Re-review with the evidence visible</h1>
    <div class="sub" id="prog">0 of ${rows.length} re-graded</div>
  </div>
  <div class="bar">
    <button class="ghost" onclick="reset()">Clear</button>
    <button onclick="save()">Download revised grades</button>
  </div>
</header>
<div class="wrap" id="app"></div>
<script>
const DATA = ${JSON.stringify(rows)};
const CALLS = ${JSON.stringify(CALLS)};
const $ = (c) => c == null ? "—" : "$" + Math.round(c/100).toLocaleString();
const store = JSON.parse(localStorage.getItem("assyze-rereview") || "{}");

function money(c){ return $(c); }

function render(){
  document.getElementById("app").innerHTML = DATA.map((r,i)=>{
    const cheap = r.comps.slice(0,6), dear = r.comps.slice(-3);
    const shown = r.comps.length > 9 ? [...cheap, null, ...dear] : r.comps;
    const compRows = shown.map(c => c === null
      ? '<tr><td colspan="4" style="color:#6b625e;padding:6px 0">… ' + (r.comps.length-9) + ' more …</td></tr>'
      : '<tr style="opacity:'+((c.used && !c.salvage)?1:.32)+'"><td class="p">'+money(c.p)+'</td>'+
        '<td class="p" style="color:'+(c.adj!==c.p?'#8ab4f8':'#6b625e')+'">'+(c.adj!==c.p?money(c.adj):'·')+'</td>'+
        '<td class="c">'+(c.c||"—")+'</td><td>'+
        (c.used?'':'<span style="color:#6b625e">[other capacity] </span>')+
        (c.salvage?'<span style="color:#ff6b5e">[salvage — excluded] </span>':'')+
        (c.t||"").slice(0,62).replace(/</g,"&lt;")+'</td></tr>').join("");

    const v = r.valuation || {};
    const net = r.netProfitCents, req = r.requiredProfitCents;
    const mathBlock = v.medianCents ? \`
      <div class="math">
        market median &nbsp;<span class="n">\${money(v.medianCents)}</span>
        &nbsp;<span style="color:#6b625e">(\${money(v.lowCents)}–\${money(v.highCents)}, n=\${v.compCount}, \${v.confidence})</span><br>
        asking &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="n">\${money(r.askingCents)}</span><br>
        \${r.bestChannel ? "best channel &nbsp;&nbsp;<span class=\\"n\\">"+r.bestChannel.channel+"</span> → net "+money(r.bestChannel.netCents)+" after "+money(r.bestChannel.feesCents)+" fees + "+money(r.bestChannel.shippingCents)+" shipping<br>" : ""}
        profit &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="\${net>=0?'pos':'neg'} n">\${money(net)}</span> vs <span class="n">\${money(req)}</span> needed for the trip
      </div>\` : '<div class="empty">No comps — engine could not price it.</div>';

    const risks = (r.riskChecks||[]).length ? '<div class="box"><h3>Hard-blocker checks</h3><div class="risks">' +
      r.riskChecks.map(c => '<div class="r"><span class="st '+c.state+'">'+c.state+'</span><span>'+
        c.label+(c.evidence? ' <span style="color:#9a908c">— '+String(c.evidence).slice(0,90).replace(/</g,"&lt;")+'</span>':'')+'</span></div>').join("") +
      '</div></div>' : "";

    const sel = store[r.ref] || {};
    return \`<div class="case">
      <div class="top">
        <div class="shots">\${r.photos.map(p=>'<img loading="lazy" src="'+p+'">').join("")}</div>
        <div class="meta">
          <p class="title"><a href="\${r.url}" target="_blank" rel="noopener">\${r.title.replace(/</g,"&lt;")}</a></p>
          <div class="price">\${money(r.askingCents)}</div>
          <div class="sub">\${r.location||""} \${r.sku? " · matched to <b>"+r.sku+"</b>":" · no SKU match"}</div>
          <div class="calls">
            <div><span class="lbl">You graded</span><span class="call \${r.human}">\${r.human}</span></div>
            <div><span class="lbl">Engine now</span><span class="call \${r.engine}">\${r.engine}</span></div>
          </div>
          <div style="font-size:13.5px">\${r.headline.replace(/</g,"&lt;")}</div>
          \${r.humanNotes? '<div class="note">your note: “'+r.humanNotes.replace(/</g,"&lt;")+'”</div>':''}
        </div>
      </div>

      <div class="box"><h3>The engine's arithmetic</h3>\${mathBlock}
        <div style="color:#9a908c;font-size:12.5px;margin-top:10px">\${r.reasoning.replace(/</g,"&lt;")}</div>
      </div>

      \${risks}

      <div class="box"><h3>Sold comps for \${r.sku||"this SKU"} — \${r.usedCount} of \${r.comps.length} used\${r.storageGb? " (filtered to "+(r.storageGb>=1024? (r.storageGb/1024)+"TB":r.storageGb+"GB")+")":""}</h3>
        \${r.comps.length? '<table><tr><td class="p" style="color:#6b625e;font-size:10.5px">SOLD</td><td class="p" style="color:#6b625e;font-size:10.5px">AS '+r.targetCond.toUpperCase()+'</td><td class="c"></td><td></td></tr>'+compRows+'</table><div style="color:#6b625e;font-size:11.5px;margin-top:8px">Second column restates each sale as <b>'+r.targetCond+'</b> condition. Salvage sales are EXCLUDED, not adjusted.</div>' : '<div class="empty">none</div>'}
      </div>

      <div class="grade">
        <span class="lbl">Your call now, with the comps in front of you</span>
        <div class="btns">\${CALLS.map(c=>'<button aria-pressed="'+(sel.call===c)+'" onclick="pick(\\''+r.ref+'\\',\\''+c+'\\')">'+c+'</button>').join("")}</div>
        <textarea placeholder="What made you change it — or what the engine is missing" oninput="note('\${r.ref}',this.value)">\${(sel.notes||"").replace(/</g,"&lt;")}</textarea>
      </div>
    </div>\`;
  }).join("");
  const n = Object.values(store).filter(s=>s.call).length;
  document.getElementById("prog").textContent = n + " of " + DATA.length + " re-graded";
}
function pick(ref, call){ store[ref] = {...(store[ref]||{}), call}; persist(); render(); }
function note(ref, notes){ store[ref] = {...(store[ref]||{}), notes}; persist(); }
function persist(){ localStorage.setItem("assyze-rereview", JSON.stringify(store)); }
function reset(){ if(confirm("Clear all re-grades?")){ localStorage.removeItem("assyze-rereview");
  for(const k of Object.keys(store)) delete store[k]; render(); } }
function save(){
  const out = Object.entries(store).filter(([,v])=>v.call)
    .map(([ref,v])=>({ref, call:v.call, notes:v.notes||""}));
  if(!out.length){ alert("Nothing re-graded yet."); return; }
  const b = new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = "assyze-rereview.json"; a.click();
}
render();
</script></body></html>`;

mkdirSync(join(import.meta.dir, "../../docs/testset"), { recursive: true });
writeFileSync(OUT, html, "utf8");

console.log(`${rows.length} cases written to ${OUT}`);
const priced = rows.filter((r) => r.valuation?.medianCents).length;
const totalComps = rows.reduce((s, r) => s + r.comps.length, 0);
console.log(`${priced} priced against real comps · ${totalComps} comp rows shown in total`);
console.log(`\nGrade them, hit "Download revised grades", then:`);
console.log(`  bun run review --import <downloaded file>`);
