/**
 * One-time carry-over of browser state from the old brand.
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 *
 * The product was renamed on 2026-09-04 and eight localStorage keys were
 * renamed with it. Those keys are not preferences — they are **his data**:
 *
 *   watch    every listing he has saved
 *   history  every listing he has checked
 *   seen     the per-segment watermark that decides what counts as new
 *   ref      the device id his saved rows are scoped to on the SERVER
 *
 * Renaming the keys without moving the values would have emptied Saved, wiped
 * his history, relit every notification badge on the next launch, and — via
 * `ref` — handed him a brand new anonymous device, orphaning whatever the
 * server had filed under the old one. That is a rename presenting as data loss,
 * which is the single worst way for a rebrand to land.
 *
 * ── WHY IT RUNS HERE AND NOT INSIDE THE READERS ────────────────────────────
 *
 * ⚠ IT MUST RUN BEFORE ANY MODULE READS STORAGE, so it is imported FIRST in
 * `main.tsx`. ES modules evaluate depth-first in import order, so this file's
 * body finishes before `App.tsx` — and therefore before `lib.tsx` and `nav.ts`
 * — is evaluated at all. Put the import second and a module-level read could
 * beat it to the old key and cache an empty value for the session.
 *
 * ⚠ AND IT NEVER OVERWRITES. If the new key already holds something, that is
 * newer than anything under the old name and the old one is simply dropped.
 * Without that guard a second device syncing later could hand him August's
 * saved list back over September's.
 *
 * ── WHEN TO DELETE IT ──────────────────────────────────────────────────────
 *
 * Once he has opened the app on his phone and his desktop after 2026-09-04,
 * this has done its whole job and the file can go. It is the only place the old
 * name still appears in the app, and it is deliberately confined to one file so
 * deleting it is a one-line change rather than an audit.
 */
const CARRY_OVER: string[] = [
  "settings", "watch", "history", "notes", "asked", "seen", "subId", "ref",
];

export function migrateLegacyStorage(): void {
  try {
    for (const key of CARRY_OVER) {
      const from = `assyze:${key}`;
      const to = `filtrsoft:${key}`;
      const value = localStorage.getItem(from);
      if (value === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, value);
      localStorage.removeItem(from);
    }
  } catch {
    /**
     * Storage throws in private mode and when the quota is full. A rebrand must
     * not be able to stop the app booting, and the cost of failing here is that
     * one device starts fresh — annoying, not broken.
     */
  }
}

migrateLegacyStorage();
