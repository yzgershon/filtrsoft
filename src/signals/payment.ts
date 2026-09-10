/** Yish, September 9: accepting crypto is not evidence of a scam. The
 * concern requires an exclusive payment demand, not a Craigslist checkbox. */
const rail = /\b(?:crypto(?:currency)?|bitcoin|btc|usdt|ethereum|gift\s?cards?|wire transfer|western union|friends\s*(?:and|&)\s*family|f\s*&\s*f|cash\s?app|zelle|venmo|apple\s?pay)\b/gi;
export function exclusivePayment(text: string): string | null {
  // A stated cash alternative means the listing does not require these rails.
  const affirmativeCash = /\b(?:cash\s+(?:or|and|accepted|preferred|ok|welcome|at pickup|on pickup|in person)|(?:accept|take|prefer|pay\s+(?:with|in))\s+cash\b)/i;
  if (affirmativeCash.test(text) && !/\b(?:do\s+not|don't|cannot|can't|won't|not)\s+(?:accept|take)\s+cash/i.test(text)) return null;
  for (const clause of text.split(/[\n.!?;]/)) {
    for (const m of clause.matchAll(rail)) {
      const before=clause.slice(Math.max(0,m.index!-65),m.index!),after=clause.slice(m.index!+m[0].length,m.index!+m[0].length+60);
      if (/\b(?:no|not|never|don't accept|do not accept)\s*$/i.test(before)||/\b(?:not|isn't|aren't)\s+(?:only|exclusively)\b/i.test(before)||/^\s+(?:is|are)\s+not\b/i.test(after)) continue;
      const exclusiveBefore=/\b(?:only|exclusively)\s+(?:(?:accept(?:s|ing|ed)?|take|taking|payments?|pay|via|by|in|with|through|using|is|are)\s+){0,4}$/i.test(before);
      const exclusiveAfter=/^\s*(?:payments?\s*)?(?:only|exclusively)\b/i.test(after);
      if ((exclusiveBefore||exclusiveAfter) && !/\bcash\s*(?:,|or|and|\/)/i.test(clause)) return clause.trim();
    }
  }
  return null;
}
