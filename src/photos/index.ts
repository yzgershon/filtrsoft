/**
 * Photo ingestion, perceptual hashing, and spec-screen detection.
 *
 * pHash powers cross-platform duplicate detection (RISK-MODEL 3.4). Near-identical
 * photos across two listings mean either the same seller cross-posted — which tells
 * you the TRUE time on market — or someone stole the photos, which is fraud. Same
 * mechanism catches both.
 *
 * Spec-screen detection exists because of the Phase 0 miss: the Dedham NZXT build
 * had its entire spec sheet in photo 3 (a shot of Windows System > About) and it got
 * skipped. Screens are the highest-value photo type and must never be dropped.
 */
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Ensure the photo root exists — same directory-vs-file trap as the database.
export const PHOTO_DIR =
  process.env.ASSYZE_PHOTOS ?? join(import.meta.dir, "../../photos");

/**
 * dHash — 64-bit difference hash. Resize to 9x8 grayscale, compare each pixel to
 * its right-hand neighbour, one bit per comparison. Robust to rescaling and
 * recompression, which is exactly what happens when a photo is reposted.
 */
export async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf)
    .greyscale()
    .resize(9, 8, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer();

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    }
  }
  // 64 bits -> 16 hex chars
  return (
    bits.match(/.{4}/g) ?? []
  ).map((n) => parseInt(n, 2).toString(16)).join("");
}

/** Hamming distance between two hex dhashes. <= 10 is a near-duplicate. */
export function distance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/**
 * REMOVED 2026-08-23: heuristic spec-screen detection.
 *
 * Tried saturation + horizontal-gradient detail against 10 hand-labelled photos.
 * Scored 5/10 — but only by predicting "not a screen" every time. It never fired
 * a single true positive. The features do not separate the classes:
 *
 *   screens      sat 0.057-0.357   detail 3.65-10.69
 *   non-screens  sat 0.149-0.303   detail 4.05-12.82
 *
 * Total overlap. The highest-saturation image in the set was a photo of a phone
 * lock screen (colourful wallpaper); the highest-detail image was a motherboard.
 *
 * It also conflates two different things: pixel-perfect SCREENSHOTS (the iPhone
 * ones) and PHOTOS OF SCREENS taken at an angle (the NZXT spec sheet).
 *
 * The vision pass identifies both trivially, so this belongs there. And the Phase 0
 * rule is "never drop photos" — so there was nothing to gate anyway, only ordering,
 * which isn't worth a detector that doesn't work.
 */

export async function downloadPhoto(url: string, listingId: number, pos: number): Promise<{ path: string; buf: Buffer }> {
  const dir = join(PHOTO_DIR, String(listingId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `p${pos}.jpg`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await Bun.write(path, buf);
  return { path, buf };
}
