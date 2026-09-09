import { publishAuthLost } from "./lib.tsx";

/** A fulfilled fetch is not necessarily a successful operation. Saved/Purchases
 * used to turn HTTP errors into empty lists or render their error JSON as data. */
export async function requestJSON<T>(url: string, init?: RequestInit, valid?: (value: any) => boolean): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (response.status === 401) publishAuthLost();
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error(response.ok ? "The server returned an unreadable response. Try again." : `Request failed (${response.status}). Try again.`); }
  if (!response.ok || data?.error) {
    const message = typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error.replaceAll("_", " ") : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (valid && !valid(data)) throw new Error("The response was incomplete. Try again.");
  return data as T;
}

export const requestMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not finish. Try again.";
