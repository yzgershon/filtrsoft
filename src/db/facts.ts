import type { RawListing } from "../types.ts";
import {isPhotoUrl} from '../sources/photo-url.ts';

export function rawObject(raw: unknown): Record<string, unknown> {
  try { if (typeof raw === "string") raw = JSON.parse(raw); } catch { return {}; }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/** Keep source facts as data. Malformed/structured values are not specs. */
export function storedAttributes(raw: unknown): Record<string, string> {
  const object = rawObject(raw);
  const attrs = rawObject(object.attributes);
  const pairs = Object.entries(attrs).filter(([,v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k,v]) => [k, String(v)]);
  if (typeof object.condition === "string" && !Object.hasOwn(attrs,"condition")) pairs.push(["condition",object.condition]);
  return Object.fromEntries(pairs);
}

export function normalizedListing(l: RawListing): RawListing {
  const attributes = {...storedAttributes(l.raw), ...l.attributes};
  return {...l, photoUrls:l.photoUrls.filter(isPhotoUrl), attributes, raw:{...rawObject(l.raw),attributes}};
}
