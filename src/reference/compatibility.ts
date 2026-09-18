/**
 * The impossibility table.
 *
 * Powers RISK-MODEL section 3f: a spec claim that is physically impossible on
 * the stated hardware. Two live examples from Phase 0 that this catches:
 *
 *   - "NVMe Gen 4 SSD" on an i7-6700K / LGA1151 platform (Gen 3 max)
 *   - A Lightning cable included with an iPhone 15 (USB-C since 2023)
 *
 * The second one Yish caught and I missed. That's why it's a table now
 * instead of something we hope to notice.
 */

export interface Contradiction {
  code: string;
  evidence: string;
}

// ------------------------------------------------------- Apple connectors
// iPhone 15 (2023) and later: USB-C. iPhone 5 (2012) - iPhone 14: Lightning.
const USBC_IPHONE_MIN = 15;

// ------------------------------------------------------- Intel/AMD sockets
interface Platform {
  socket: string;
  pcieMax: number;
  memory: ("DDR3" | "DDR4" | "DDR5")[];
}

const CPU_PLATFORMS: Array<{ match: RegExp; p: Platform }> = [
  // Intel — 6th/7th/8th/9th gen desktop. FOUR digits: 6700K, 7700K, 8700K, 9900K.
  { match: /\bi[357]-[6789]\d{3}[a-z]*\b/i, p: { socket: "LGA1151", pcieMax: 3, memory: ["DDR4"] } },
  // 10th gen (Comet Lake) — LGA1200, still PCIe 3.0
  { match: /\bi[3579]-10\d{3}[a-z]*\b/i, p: { socket: "LGA1200", pcieMax: 3, memory: ["DDR4"] } },
  // 11th gen (Rocket Lake) — LGA1200, PCIe 4.0
  { match: /\bi[3579]-11\d{3}[a-z]*\b/i, p: { socket: "LGA1200", pcieMax: 4, memory: ["DDR4"] } },
  // 12th-14th gen — LGA1700, PCIe 5.0, DDR4 or DDR5 depending on board
  { match: /\bi[3579]-1[234]\d{3}[a-z]*\b/i, p: { socket: "LGA1700", pcieMax: 5, memory: ["DDR4", "DDR5"] } },
  // AMD Zen 1-3 — AM4, DDR4. PCIe 4.0 only on X570/B550 with Zen 2+.
  { match: /\bryzen\s*[3579]\s*[1235]\d{3}[a-z0-9]*\b/i, p: { socket: "AM4", pcieMax: 4, memory: ["DDR4"] } },
  // AMD Zen 4/5 — AM5, DDR5 only, PCIe 5.0
  { match: /\bryzen\s*[3579]\s*[79]\d{3}[a-z0-9]*\b/i, p: { socket: "AM5", pcieMax: 5, memory: ["DDR5"] } },
];

export function detectPlatform(text: string): Platform | null {
  for (const { match, p } of CPU_PLATFORMS) if (match.test(text)) return p;
  return null;
}

/** Datacenter and mining cards with NO display outputs. Not GPUs for any normal buyer. */
export const NO_DISPLAY_OUTPUT = [
  /\btesla\s*[pvamk]\d+/i, /\bnvidia\s+a(100|30|40|10)\b/i,
  /\bcmp\s*\d+hx\b/i, /\bmi\d{2,3}\b/i, /\bradeon\s+instinct\b/i,
];

import {factualText} from '../signals/factual-text.ts';
import {coordinatedDamageDenial,memoryCompatibilityDenial} from '../signals/condition.ts';
export function findContradictions(text: string): Contradiction[] {
  const out: Contradiction[] = [];
  const t = text.toLowerCase();

  // --- iPhone connector mismatch (Yish's catch) ---
  const ip = t.match(/iphone\s*(\d{1,2})/);
  if (ip) {
    const gen = Number(ip[1]);
    const saysLightning = /\blightning\b/.test(t);
    const saysUsbc = /\busb[\s-]?c\b/.test(t);
    if (gen >= USBC_IPHONE_MIN && saysLightning) {
      out.push({
        code: "IMPOSSIBLE_CONNECTOR",
        evidence: `Listing mentions a Lightning cable but the iPhone ${gen} uses USB-C. Seller may not have the device, or is describing a different phone.`,
      });
    }
    if (gen >= 5 && gen < USBC_IPHONE_MIN && saysUsbc && !/charger|adapter|brick/.test(t)) {
      out.push({
        code: "IMPOSSIBLE_CONNECTOR",
        evidence: `Listing mentions USB-C but the iPhone ${gen} uses Lightning.`,
      });
    }
  }

  // --- PCIe generation vs CPU platform ---
  const plat = detectPlatform(text);
  if (plat) {
    const genClaim = t.match(/(?:pcie|pci-e|gen)\s*(\d)\b/);
    if (genClaim && Number(genClaim[1]) > plat.pcieMax) {
      out.push({
        code: "IMPOSSIBLE_SPEC_CLAIM",
        evidence: `Claims PCIe Gen ${genClaim[1]} but the ${plat.socket} platform supports Gen ${plat.pcieMax} at most. The drive will run at Gen ${plat.pcieMax} speeds.`,
      });
    }
    // --- memory generation vs platform ---
    for (const ddr of ["DDR3", "DDR4", "DDR5"] as const) {
      if (new RegExp(`\\b${ddr}\\b`, "i").test(factualText(text)) && !plat.memory.includes(ddr)) {
        out.push({
          code: "IMPOSSIBLE_SPEC_CLAIM",
          evidence: `Claims ${ddr} but ${plat.socket} supports ${plat.memory.join(" or ")} only.`,
        });
      }
    }
  }

  // --- condition claim vs disclosed damage ---
  // Negation-aware: "zero scratches or dents" is a CLAIM of good condition, not
  // a disclosure of damage. Without this the check fires on every clean listing.
  const claimsMint = /\b(like new|mint|excellent|pristine|flawless)\b/.test(t);
  const DAMAGE = /\b(crack\w*|broken|detached|shatter\w*|water damage|does ?n.t (work|turn on)|taped?|dent\w*|scratch\w*)\b/g;
  const NEGATED = /\b(no|zero|not?|without|free of|never|nor|any)\s+(\w+\s+){0,3}$/i;
  let damage: string | null = null;
  for (const m of t.matchAll(DAMAGE)) {
    const before = t.slice(Math.max(0, m.index! - 40), m.index!);
    if(coordinatedDamageDenial(before)||memoryCompatibilityDenial(m[0],t.slice(m.index!+m[0].length)))continue;
    if (NEGATED.test(before)) continue;           // "zero scratches or dents"
    if (/\b(or|and)\s+$/.test(before) && /\b(no|zero|without|free of)\b/.test(before)) continue;
    // Quote a readable window, not the bare token — "c" is not evidence.
    damage = t.slice(m.index!, Math.min(t.length, m.index! + 60)).trim();
    break;
  }
  if (claimsMint && damage) {
    out.push({
      code: "CONDITION_CONTRADICTION",
      evidence: `Describes condition as "like new"/"mint" while also disclosing: "${damage}".`,
    });
  }

  // --- display-less compute card sold as a graphics card ---
  if (NO_DISPLAY_OUTPUT.some((r) => r.test(text))) {
    if (/\b(gaming|graphics card|display|monitor|animation|video editing)\b/.test(t)) {
      out.push({
        code: "NO_DISPLAY_OUTPUT",
        evidence: `This is a datacenter/compute accelerator with no video outputs, but the listing frames it as a graphics card. You cannot connect a monitor to it, and it is passively cooled for server airflow.`,
      });
    }
  }

  return out;
}
