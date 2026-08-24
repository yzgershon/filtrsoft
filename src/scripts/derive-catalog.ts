/**
 * bun run catalog:derive [--min N] [--apply]
 *
 * Dry run by default. Prints what it WOULD add and changes nothing.
 */
import { deriveCandidates, applyCandidates } from "../catalog/derive.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes("--apply");

const cands = deriveCandidates({ minSeen: Number(arg("min")) || 2 });
const fresh = cands.filter((c) => !c.existing);

console.log(`${cands.length} models observed · ${cands.length - fresh.length} already in the catalog · \x1b[1m${fresh.length} new\x1b[0m\n`);

const byCat = new Map<string, typeof fresh>();
for (const c of fresh) {
  if (!byCat.has(c.category)) byCat.set(c.category, []);
  byCat.get(c.category)!.push(c);
}
for (const [cat, list] of [...byCat.entries()].sort()) {
  console.log(`\x1b[1m${cat}\x1b[0m (${list.length})`);
  for (const c of list.slice(0, 20)) {
    console.log(`  ${String(c.seen).padStart(3)}x  ${(c.brand + " " + c.model).padEnd(28)} ${c.examples[0] ?? ""}`);
  }
  if (list.length > 20) console.log(`  … and ${list.length - 20} more`);
  console.log();
}

if (apply) {
  const n = applyCandidates(fresh);
  console.log(`\x1b[32madded ${n} SKUs\x1b[0m`);
} else {
  console.log("dry run — pass --apply to write these to the catalog");
}
