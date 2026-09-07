/** bun run src/scripts/retire-repeated-appliances.ts [--dry] */
import { retireRepeatedAppliances } from "../db/retire-appliances.ts";

const dry = process.argv.includes("--dry");
const candidates = retireRepeatedAppliances(dry);
for (const row of candidates) console.log(`#${row.id} ${row.title}`);
console.log(`${candidates.length} repeated household appliance listings`);
if (!dry) {
  console.log("Retired recoverably; listing facts and photos remain intact.");
}
