/** Stored application timestamps use ISO T/Z, not SQLite's space format. */
export const isoAgo = (milliseconds: number, at = Date.now()): string => new Date(at - milliseconds).toISOString();
