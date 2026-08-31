# The VaultX design system — measured, not guessed

Assyze's visual system as of 2026-08-31. Yish: *"literally abandon everything
from Assyze and use this design system to make it look amazing and use the
demo's colors aswell."*

Source: <https://ui-ux-pro-max-skill.nextlevelbuilder.io/demo/crypto-wallet>

⚠ **EVERY VALUE HERE WAS READ OFF THE RUNNING DEMO**, not from the skill's
generic `--design-system` search. That search returns gold `#F59E0B` + purple
for "fintech crypto" and recommends Orbitron/JetBrains Mono — none of which the
demo uses. The demo is the brief; the search is not.

Extraction script: `src/browser/extract-design-tokens.mjs` (re-runnable).

## Type

| Role | Font | Weight | Notes |
|---|---|---|---|
| Headings | **Space Grotesk** | 700 | Dominant: 367 elements on the page |
| Body | **DM Sans** | 400 / 500 | |

    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

H1 is 60px/60px 700. H2 is 36px 700. Body 16px/24px. Letter-spacing is
**normal** — the demo does not track its headings tight.

## Colour

| Token | Value | Uses | Role |
|---|---|---|---|
| Background | `#0A0E17` | page | OLED navy, not black |
| Header | `rgba(10,14,23,.9)` + blur | 1 | glass over the page |
| Surface | `rgba(255,255,255,.05)` | **53** | the glass card fill |
| Border | `rgba(255,255,255,.1)` | **48** | the only border colour |
| Ink | `#FFFFFF` | 229 | |
| Ink muted | `#94A3B8` | 76 | |
| **Cyan (primary)** | `#00D4FF` | 19 | badges, links, accent word |
| **Green (success)** | `#00FF88` | 27 | gains, confirmations |
| **Purple (secondary)** | `#7B61FF` | | gradient partner |
| Red (danger) | `#FF4757` | | losses |

⚠ **THE SIGNATURE IS ONE GRADIENT** and it is used for the logo mark, the
primary CTA and the accent word in every headline:

    linear-gradient(135deg, #00D4FF 0%, #7B61FF 100%)

## Shape

| Radius | Uses | Applies to |
|---|---|---|
| **20px** | 34 | cards, panels |
| 9999 / 50px | 27 | pills, badges, avatars |
| 12px | 15 | small tiles, icon chips |
| 8px | 9 | inline chips |

## Depth

Glass, not shadow. `backdrop-filter: blur(20px)` and `blur(16px)`.

The only shadows are **coloured glows**, never black drop shadows:

    0 0 60px rgba(0,212,255,.2)      /* cyan */
    0 0 60px rgba(123,97,255,.2)     /* purple */

## Motion

    @keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-20px) } }
    @keyframes pulse { 50% { opacity: .5 } }

`pulse` runs `2s cubic-bezier(.4,0,.6,1)`. Transitions are `all .3s ease` and
`all .2s ease`. ⚠ Everything animated is `transform` or `opacity` — nothing
animates layout.

## The section rhythm

Every section on the demo repeats one structure, and it is the layout Yish
called out:

1. **Centred pill badge** — glass fill, 1px border, cyan text, 50px radius,
   14px/500, `6px 14px` padding.
2. **Big Space Grotesk headline**, white, with ONE accent word in the cyan
   gradient.
3. **Muted `#94A3B8` subtitle**, one line.
4. **Grid of glass cards** — icon in accent colour, bold white title, muted body.

## Mapping onto Assyze's verdicts

⚠ **THE VERDICT COLOURS ARE THE PRODUCT AND THEY ARE NOT DECORATION.** They
carry the only judgement the app makes, so they move to the demo's palette
rather than being dropped:

| Verdict | Was | Now | Why |
|---|---|---|---|
| BUY | `#34d399` | **`#00FF88`** | the demo's success green |
| VERIFY | `#ff8a3d` | **`#FFC53D`** | amber — see the note below |
| RISK | `#f87171` | **`#FF4757`** | the demo's danger red |
| FAIR | `#60a5fa` | **`#7B61FF`** | the demo's secondary purple |
| PASS | `#fbbf24` | **`#94A3B8`** | muted: priced and rejected is not a warning |
| Can't tell | `#a78bfa` | **`#64748B`** | quieter still |

⚠ **VERIFY IS THE ONE VALUE HERE THAT IS NOT THE DEMO'S.** It was mapped to
the demo's primary cyan, which is also `--brand`: the wordmark, the segment
indicator, the CTA and the focus ring. So the one palette entry that carries a
JUDGEMENT rendered in the same colour as ordinary chrome. Yish, 2026-08-31:
*"if it's a buy it's green, verify is yellow, pass is black still, and risky is
red."* Amber restores green → amber → red as a progression and gives cyan back
to the brand.

⚠ **BUY green and RISK red are a colour-blind-unsafe pair on their own.** They
are safe here because every verdict is also a WORD on screen ("BUY IT",
"RISKY") and an icon — colour is never the only indicator. Do not remove those
labels to save space.

⚠ **ASSYZE'S BRAND ORANGE `#ff8a3d` IS GONE.** The demo has no orange except as
a Bitcoin token colour. The brand is the cyan→purple gradient now.
