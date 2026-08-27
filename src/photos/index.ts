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
import { mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
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
  const buf = await fetchPhoto(url);
  await Bun.write(path, buf);
  return { path, buf };
}

/** Download bytes without touching the volume. Used by the text-only hash pass. */
export async function fetchPhoto(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * ---- RETENTION ------------------------------------------------------------
 *
 * **PHOTOS ARE A WORKING FILE, NOT AN ASSET, and treating them as an asset
 * filled the production volume and took the site's crawler down for 13 hours.**
 * Reads kept working the whole time, so the feed looked healthy while nothing
 * refreshed, no sweep ran and the comps archive could not import.
 *
 * The bytes are needed exactly twice and both happen inside one check:
 *
 *   1. `dhash` — to compute the perceptual hash
 *   2. `analyzePhotos` — vision reads the files from disk
 *
 * After that nothing ever opens them again. `local_path` is written to
 * `listing_photos` and **never read back anywhere in the codebase** — the feed
 * thumbnail and every link use the SOURCE url, not the local copy. So the file
 * is pure cost: 316 MB for 654 listings locally, growing without bound, and on
 * the same volume as the database.
 *
 * What survives is the 16-character `phash`, which is what the risk model
 * actually needs for stolen-photo and repost detection. A few kilobytes
 * instead of hundreds of megabytes.
 *
 * `ASSYZE_KEEP_PHOTOS=1` retains them, for eval work where the images are the
 * point.
 */
export const KEEP_PHOTOS = process.env.ASSYZE_KEEP_PHOTOS === "1";

/** Delete one listing's downloaded photos. The phash rows are left alone. */
export function releasePhotos(listingId: number): number {
  if (KEEP_PHOTOS) return 0;
  const dir = join(PHOTO_DIR, String(listingId));
  if (!existsSync(dir)) return 0;
  let freed = 0;
  try {
    for (const f of readdirSync(dir)) {
      try { freed += statSync(join(dir, f)).size; } catch { /* counting only */ }
    }
    rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Never let cleanup break a check. Worst case the file lingers for the
    // scheduled prune to collect.
    console.error(`releasePhotos(${listingId}) failed: ${(e as Error).message}`);
  }
  return freed;
}

/**
 * Sweep the whole photo directory.
 *
 * Exists for the backlog that accumulated before retention was added, and as a
 * standing backstop: a check that crashes between download and release leaves a
 * directory behind, and without this those orphans are permanent.
 *
 * Directory names are listing ids, so this needs no database read to decide
 * what to delete — every directory is by definition finished work.
 */
export function prunePhotos(opts: { dryRun?: boolean } = {}): { dirs: number; bytes: number } {
  if (!existsSync(PHOTO_DIR)) return { dirs: 0, bytes: 0 };
  let dirs = 0, bytes = 0;
  for (const name of readdirSync(PHOTO_DIR)) {
    const dir = join(PHOTO_DIR, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      let size = 0;
      for (const f of readdirSync(dir)) {
        try { size += statSync(join(dir, f)).size; } catch { /* counting only */ }
      }
      if (!opts.dryRun) rmSync(dir, { recursive: true, force: true });
      dirs++; bytes += size;
    } catch { /* a file we cannot stat is a file we cannot delete */ }
  }
  return { dirs, bytes };
}
