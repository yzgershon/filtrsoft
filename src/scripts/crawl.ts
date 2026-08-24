/**
 * Fill the feed.
 *   bun run crawl [--pages 1] [--vision 10] [--cat sya,moa]
 */
import { crawl, CATEGORIES } from "../crawler/index.ts";

const a = process.argv.slice(2);
const num = (flag: string, d: number) => {
  const i = a.indexOf(flag);
  return i >= 0 ? Number(a[i + 1]) || d : d;
};
const catFlag = a.indexOf("--cat");
const categories = catFlag >= 0 ? a[catFlag + 1].split(",") : undefined;

console.log(`crawling ${(categories ?? CATEGORIES.map((c) => c.cat)).join(", ")}\n`);
const t0 = Date.now();
const st = await crawl({
  categories,
  pages: num("--pages", 1),
  limit: num("--limit", 0) || undefined,
  concurrency: num("--conc", 6),
  maxVision: num("--vision", 10),
  onProgress: (m) => console.log(m),
});

console.log(`
──────────────────────────────
discovered      ${st.discovered}
already known   ${st.alreadySeen}
analysed        ${st.analysed}
photos read     ${st.visionRun}
failed          ${st.failed}
worth showing   ${st.worthShowing}
took            ${((Date.now() - t0) / 1000).toFixed(0)}s`);
