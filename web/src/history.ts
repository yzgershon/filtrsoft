/** Entry-owned depth survives browser Forward. A counter decremented on every
 * popstate mistakes Forward for Back and can discard a filtered feed. */
export const NAVIGATE = "filtrsoft:navigate";
const KEY = "__filtrsoftDepth";
export const POPUP_KEY = "filtrsoftPopup";
function routeState() {
  const { [POPUP_KEY]: _popup, ...state } = history.state ?? {};
  return state;
}
export function historyDepth(): number {
  const value = history.state?.[KEY];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function pushRoute(url: string) {
  history.pushState({ ...routeState(), [KEY]: historyDepth() + 1 }, "", url);
  dispatchEvent(new Event(NAVIGATE));
}
export function replaceRoute(url: string, notify = true) {
  history.replaceState({ ...routeState(), [KEY]: historyDepth() }, "", url);
  if (notify) dispatchEvent(new Event(NAVIGATE));
}
