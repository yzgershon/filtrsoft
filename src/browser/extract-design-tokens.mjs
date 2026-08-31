/**
 * Extract the VaultX demo's real design tokens by rendering it.
 *
 * The demo ships one shared Tailwind bundle for every demo on the site, so
 * grepping the CSS returns every colour the whole gallery uses. Computed styles
 * off the live page are the only honest source.
 */
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
await p.goto("https://ui-ux-pro-max-skill.nextlevelbuilder.io/demo/crypto-wallet", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

const tokens = await p.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (el, props) => {
    const s = cs(el);
    if (!s) return null;
    return Object.fromEntries(props.map((k) => [k, s[k]]));
  };
  const bodyS = cs(document.body);

  // Every distinct background/border/colour actually painted, with counts.
  const tally = (fn) => {
    const m = new Map();
    for (const el of document.querySelectorAll("*")) {
      const v = fn(getComputedStyle(el), el);
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  };

  const h1 = document.querySelector("h1");
  const h2 = document.querySelector("h2");
  const btn = [...document.querySelectorAll("button, a")]
    .find((e) => /launch app|download/i.test(e.textContent || ""));
  const card = document.querySelector("[class*='rounded-2xl'], [class*='rounded-xl']");
  const badge = [...document.querySelectorAll("span,div")]
    .find((e) => /^(Features|Multi-Chain|Security First)$/i.test((e.textContent || "").trim()));

  return {
    body: pick(document.body, ["backgroundColor", "color", "fontFamily", "fontSize", "lineHeight"]),
    h1: pick(h1, ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color"]),
    h1Text: h1?.textContent?.trim().slice(0, 40),
    h2: pick(h2, ["fontFamily", "fontSize", "fontWeight", "letterSpacing"]),
    cta: btn ? { ...pick(btn, ["backgroundImage", "backgroundColor", "color", "borderRadius", "fontWeight", "fontSize", "padding", "boxShadow", "transitionDuration", "transitionTimingFunction"]), text: btn.textContent?.trim() } : null,
    card: card ? { ...pick(card, ["backgroundColor", "borderColor", "borderWidth", "borderRadius", "backdropFilter", "boxShadow"]), cls: card.className.slice(0, 120) } : null,
    badge: badge ? { ...pick(badge, ["backgroundColor", "color", "borderRadius", "fontSize", "fontWeight", "padding", "borderColor"]), text: badge.textContent?.trim() } : null,
    backgrounds: tally((s) => (s.backgroundColor !== "rgba(0, 0, 0, 0)" ? s.backgroundColor : null)),
    borders: tally((s) => (parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : null)),
    textColors: tally((s) => s.color),
    radii: tally((s) => (parseFloat(s.borderTopLeftRadius) > 0 ? s.borderTopLeftRadius : null)),
    fonts: tally((s) => s.fontFamily.split(",")[0].replace(/"/g, "")),
    gradients: [...new Set([...document.querySelectorAll("*")]
      .map((e) => getComputedStyle(e).backgroundImage)
      .filter((v) => v.includes("gradient")))].slice(0, 12),
    blurs: [...new Set([...document.querySelectorAll("*")]
      .map((e) => getComputedStyle(e).backdropFilter)
      .filter((v) => v && v !== "none"))].slice(0, 8),
    shadows: [...new Set([...document.querySelectorAll("*")]
      .map((e) => getComputedStyle(e).boxShadow)
      .filter((v) => v && v !== "none"))].slice(0, 10),
    // Keyframe animations defined in the stylesheet.
    keyframes: (() => {
      const out = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const r of sheet.cssRules) {
            if (r.type === CSSRule.KEYFRAMES_RULE) out.push(r.cssText.slice(0, 220));
          }
        } catch { /* cross-origin */ }
      }
      return out.slice(0, 14);
    })(),
    animatedEls: [...new Set([...document.querySelectorAll("*")]
      .map((e) => {
        const s = getComputedStyle(e);
        return s.animationName !== "none" ? `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction}` : null;
      })
      .filter(Boolean))].slice(0, 12),
    transitions: [...new Set([...document.querySelectorAll("*")]
      .map((e) => {
        const s = getComputedStyle(e);
        return s.transitionDuration !== "0s" ? `${s.transitionProperty.slice(0, 40)} ${s.transitionDuration} ${s.transitionTimingFunction}` : null;
      })
      .filter(Boolean))].slice(0, 10),
  };
});

console.log(JSON.stringify(tokens, null, 1));
await p.screenshot({ path: "docs/ui/vaultx/hero.png" });
await p.evaluate(() => window.scrollTo(0, 900));
await p.waitForTimeout(1200);
await p.screenshot({ path: "docs/ui/vaultx/features.png" });
await b.close();
