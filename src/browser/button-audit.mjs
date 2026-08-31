/**
 * One button audit, shared by `measure.mjs` and `ui-verify.mjs`.
 *
 * ⚠ THIS FUNCTION IS SERIALISED INTO THE PAGE by `page.evaluate`, so it MUST
 * be self-contained: no imports, no closures over module scope, no optional
 * chaining on things that might be undefined at parse time in an older engine.
 * It runs in Chrome, not in Node.
 *
 * ── WHY EACH CHECK EXISTS ──────────────────────────────────────────────────
 *
 * Every one of them is a bug that shipped and that a screenshot review walked
 * straight past, because "slightly off" does not look like a defect until it is
 * measured. Yish, 2026-08-31: *"the saved tab has some buttons that are bugged
 * like the browse deals and the saved icon are not centered or cut off, so make
 * sure there's no button like that and all the buttons in Assyze are perfect."*
 *
 *   · **tap** — 44x44 is the Apple HIG / Material floor. A 30px bookmark on a
 *     card you use one-handed is the single most common miss in this app.
 *   · **contains** — a child hanging outside its own button. Usually a flex
 *     item that cannot shrink.
 *   · **ink** — content within 4px of the button's own border, which reads as
 *     CUT OFF even when nothing is technically clipped. `.btn2` had zero
 *     horizontal padding: "Browse deals" rendered with its icon 1px from the
 *     left edge.
 *   · **centred** — content sitting off the vertical middle by more than 3px.
 *     `.empty svg { margin-bottom: 12px }` was a descendant selector, so it
 *     landed on the icon inside every empty-state button and tile and shifted
 *     each one up by 6px.
 *
 * Absolutely-positioned children are skipped throughout: badges and the
 * bookmark's own `::before` circle are meant to sit outside the flow.
 */
export function auditButtons() {
  /**
   * The box the button's actual INK occupies — element children and text runs
   * both. Text nodes have no `getBoundingClientRect`, and they are exactly what
   * "the label touches the border" is about, so they are measured with a Range.
   */
  const inkBox = (el) => {
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    let any = false;
    const eat = (rect) => {
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      any = true;
      l = Math.min(l, rect.left); r = Math.max(r, rect.right);
      t = Math.min(t, rect.top); b = Math.max(b, rect.bottom);
    };
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) eat(rect);
        range.detach();
      } else if (node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (cs.position === "absolute" || cs.position === "fixed") continue;
        eat(node.getBoundingClientRect());
      }
    }
    return any ? { left: l, right: r, top: t, bottom: b } : null;
  };

  const out = [];
  for (const el of document.querySelectorAll("button, a.origin, a.btn2, a.cta")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    const problems = [];
    if (box.height < 44 || box.width < 44) {
      problems.push(`tap ${Math.round(box.width)}x${Math.round(box.height)}`);
    }

    /**
     * ⚠ THE INK CHECK ONLY APPLIES TO A BUTTON WITH A VISIBLE EDGE, and that
     * qualification is the difference between a useful check and 60 lines of
     * noise.
     *
     * "Cut off" is a relationship between ink and a BORDER. A `.gopen` card is
     * a transparent wrapper whose photo is meant to be flush to the corners,
     * and the wordmark is bare text — flagging either would train you to ignore
     * this list, which is how the real 1px-from-the-edge case survived.
     */
    const edged = !(cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent")
      || (cs.backgroundImage && cs.backgroundImage !== "none")
      || (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0);

    const ink = inkBox(el);
    if (ink) {
      const over = Math.max(
        Math.round(ink.right - box.right), Math.round(box.left - ink.left),
        Math.round(ink.bottom - box.bottom), Math.round(box.top - ink.top),
      );
      if (over > 0) problems.push(`contains +${over}px`);

      /**
       * ⚠ AND NOT WHEN SOMETHING IS DELIBERATELY FULL-BLEED. A child spanning
       * essentially the whole button is a photo filling a card, which is the
       * point of `.dealhero` and `.gcard` — the flush edge is the design, not a
       * missing gutter. Only a LABEL crowding a border is a defect.
       */
      let bleed = false;
      for (const ch of el.children) {
        const cr = ch.getBoundingClientRect();
        if (cr.width >= box.width * 0.96 && cr.height > 24) bleed = true;
      }

      if (over <= 0 && edged && !bleed) {
        const padL = Math.round(ink.left - box.left);
        const padR = Math.round(box.right - ink.right);
        if (Math.min(padL, padR) < 4) problems.push(`ink ${padL}/${padR}px from the edge`);
      }

      const off = Math.round((ink.top - box.top) - (box.bottom - ink.bottom));
      if (over <= 0 && Math.abs(off) > 3) problems.push(`off centre ${off > 0 ? "+" : ""}${off}px`);
    }

    out.push({
      cls: String(el.className || el.tagName),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 26),
      w: Math.round(box.width), h: Math.round(box.height),
      problems,
    });
  }
  return out;
}
