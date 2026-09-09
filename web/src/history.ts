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
const tabRoutes = new Map<string, string>();
const tabName = (path: string) => path === "/" ? "deals" : /^\/(check|saved|more|settings)\/?$/.exec(path)?.[1];
export function tabDestination(tab: string): string | undefined {
  return tabName(location.pathname) === tab ? location.pathname + location.search : tabRoutes.get(tab);
}
export function clearTabRoutes() { tabRoutes.clear(); }
export function pushRoute(url: string, restore = false) {
  const leaving = tabName(location.pathname);
  if (leaving) tabRoutes.set(leaving, location.pathname + location.search);
  history.pushState({ ...routeState(), [KEY]: historyDepth() + 1 }, "", url);
  dispatchEvent(new CustomEvent(NAVIGATE, { detail: { restore } }));
}
export function replaceRoute(url: string, notify = true) {
  history.replaceState({ ...routeState(), [KEY]: historyDepth() }, "", url);
  if (notify) dispatchEvent(new Event(NAVIGATE));
}
