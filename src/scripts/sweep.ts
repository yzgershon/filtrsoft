/**
 * bun run sweep  [--pages N] [--probe N] [--cat sya,moa]
 *
 * Re-crawl what we have already seen and record what changed. Run it daily —
 * every day it does not run is clearing-price history nobody can refetch.
 */
import { sweep, outcomes } from "../tracker/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const money = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(0)}`);

const st = await sweep({
  pages: Number(arg("pages")) || 1,
  probeLimit: arg("probe") ? Number(arg("probe")) : undefined,
  categories: arg("cat")?.split(","),
  onProgress: (m) => console.log(m),
});

console.log(`
\x1b[1msweep\x1b[0m
  live before    ${st.liveBefore}
  currently up   ${st.discovered}
  still up       ${st.stillUp}
  probed         ${st.probed}
  delisted       ${st.delisted}  ${Object.entries(st.byReason).map(([k, v]) => `${k}=${v}`).join(" ") || ""}
  price changes  ${st.priceMoves}
`);

const all = outcomes();
const sold = all.filter((o) => o.signal === "likely_sold");
if (all.length) {
  console.log(`\x1b[1m${all.length} delisted · ${sold.length} likely sold\x1b[0m\n`);
  for (const o of all.slice(0, 25)) {
    const tag = { likely_sold: "\x1b[32mSOLD\x1b[0m", possibly_sold: "\x1b[33m?   \x1b[0m",
      repost: "\x1b[36mREPO\x1b[0m", no_signal: "\x1b[90m—   \x1b[0m" }[o.signal];
    const d = o.daysOnMarket === null ? "  ?" : `${o.daysOnMarket.toFixed(0).padStart(3)}d`;
    console.log(`  ${tag} ${d} ${money(o.clearingPriceCents).padStart(6)}  ${o.title.slice(0, 46).padEnd(46)} ${o.reason}`);
  }
}
