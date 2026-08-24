/**
 * Check a live URL through the engine, printing each stage as it lands.
 *   bun run check <url> [--vision] [--drive 15]
 */
import { checkListing } from "../engine/index.ts";

const argv = process.argv.slice(2);
const vision = argv.includes("--vision");
const di = argv.indexOf("--drive");
const drive = di >= 0 ? Number(argv[di + 1]) : 15;
const url = argv.find((a) => a.startsWith("http"));
if (!url) { console.log("usage: bun run check <url> [--vision]"); process.exit(1); }

const C: Record<string, string> = { BUY: "\x1b[32m", FAIR: "\x1b[36m", PASS: "\x1b[33m", VERIFY: "\x1b[35m", RISK: "\x1b[31m" };

await checkListing(url, {
  vision, persist: true, driveMinutes: drive,
  onStage: (s) => {
    const t = `\x1b[2m${String(s.elapsedMs).padStart(6)}ms\x1b[0m`;
    const d = s.data as any;
    if (s.stage === "fetched")
      console.log(`${t}  fetched   ${d.title?.slice(0, 50)} · ${d.photoUrls?.length} photos`);
    if (s.stage === "signals")
      console.log(`${t}  signals   ${d.signals.length} flags · ${d.category} · quality ${d.listingQuality} · sophistication ${d.sellerSophistication}`);
    if (s.stage === "valued")
      console.log(`${t}  valued    ${C[d.verdict.call] ?? ""}${d.verdict.call}\x1b[0m — ${d.verdict.headline}`);
    if (s.stage === "vision")
      console.log(`${t}  vision    ${C[d.verdict.call] ?? ""}${d.verdict.call}\x1b[0m — ${d.verdict.headline}`);
    if (s.stage === "done")
      console.log(`${t}  done`);
  },
});
