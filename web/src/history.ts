/** Entry-owned depth survives browser Forward. A counter decremented on every
 * popstate mistakes Forward for Back and can discard a filtered feed. */
export const NAVIGATE = "filtrsoft:navigate";
const KEY = "__filtrsoftDepth";
export function historyDepth(): number {
  const value = history.state?.[KEY];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function pushRoute(url: string) {
  history.pushState({ ...history.state, [KEY]: historyDepth() + 1 }, "", url);
  dispatchEvent(new Event(NAVIGATE));
}
export function replaceRoute(url: string, notify = true) {
  history.replaceState({ ...history.state, [KEY]: historyDepth() }, "", url);
  if (notify) dispatchEvent(new Event(NAVIGATE));
}
