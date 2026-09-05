/**
 * The Filtrsoft mark and wordmark. ONE definition, used by the app's top bar
 * and by all four wordmarks on the landing page.
 *
 * It lives in its own file because the wordmark was previously written out
 * five times as literal JSX (`filtr<span>soft</span>`) — App.tsx once and
 * landing.tsx four times. A brand that is copy-pasted into five places is a
 * brand that ends up in three different states, which is exactly what happened
 * at the rename: the icon still said one thing while every screen said another.
 *
 * ── THE MARK ───────────────────────────────────────────────────────────────
 *
 * Three shapes: a wide bar, a narrower bar, and one rounded square. It is the
 * product's own number — 4,482 live listings on the day it was drawn, 1,410 in
 * scope, 429 with a verdict, 28 worth driving for. Wide, narrower, the one.
 *
 * ⚠ THE BOTTOM SHAPE IS A SQUARE, NOT A THIRD BAR, AND THAT IS THE WHOLE MARK.
 * Three narrowing bars is the generic filter glyph that ships in every data
 * table on the internet, including the filter control in Filtrsoft's own feed
 * toolbar. The square stops being part of the stack and starts being the thing
 * the stack produced. If it is ever "simplified" back into a bar, the mark is
 * gone and the logo collides with a button.
 *
 * ⚠ THE BARS ARE currentColor AND DIM ON PURPOSE. In the top bar the logo sits
 * one line above the BUY and VERIFY chips, and those chips are the only
 * judgement the app makes. A logo that competes with them is a logo that makes
 * the product harder to read. The standalone icon is the opposite case and uses
 * its own, much higher, contrast — see src/browser/make-icons.mjs.
 *
 * Options considered and why this one won:
 * docs/20260905-logo-options-preview.html
 */
import { useId } from "react";

type MarkProps = { size?: number; className?: string };

export function BrandMark({ size = 22, className }: MarkProps) {
  /**
   * A gradient needs an id, and this component renders in several places at
   * once (top bar, landing nav, landing footer, the fake phone). Duplicate ids
   * in one document mean every instance silently resolves to the first one, so
   * each gets its own.
   *
   * ⚠ STRIPPED TO ALPHANUMERICS. React 19's useId returns something like
   * `«r3»`, and those are not characters to put inside a `url(#...)` fragment
   * reference and hope.
   */
  const id = `fsg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00d4ff" />
          <stop offset="1" stopColor="#7b61ff" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="3.2" width="19" height="2.8" rx="1.4" fill="currentColor" opacity=".4" />
      <rect x="6.25" y="9" width="11.5" height="2.8" rx="1.4" fill="currentColor" opacity=".75" />
      <rect x="8.9" y="14.8" width="6.2" height="6.2" rx="2" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * ── THE WORDMARK ───────────────────────────────────────────────────────────
 *
 * All lowercase, all ink, with the brand gradient on the dot of the i and
 * nowhere else. Yish, 2026-09-05: *"i want 01 filter and a gradient dot on the
 * i uncapitalized f filtrsoft"*.
 *
 * ⚠ THE LETTER IN THE DOM IS A REAL "i". The tittle is coloured by a
 * background stop in `.wmi` (02-shell.css), not by swapping in a dotless i
 * (U+0131), because that would put "fıltrsoft" into copy-paste, find-in-page
 * and the accessibility tree — a word that is not the product's name.
 *
 * ⚠ AND IT IS WRAPPED IN ONE SPAN. `.brand` is a flex row, and flex turns each
 * contiguous text run into its own anonymous item — so an unwrapped
 * `f<span>i</span>ltrsoft` would become THREE flex boxes with the word broken
 * across them. The outer span keeps the whole word as one inline context.
 */
export const Wordmark = () => (
  <span className="wmk">
    f<span className="wmi">i</span>ltrsoft
  </span>
);
