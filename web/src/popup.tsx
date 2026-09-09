import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Cross } from "./icons.tsx";
import { POPUP_KEY } from "./history.ts";

export const motionAllowed = () => !matchMedia("(prefers-reduced-motion: reduce)").matches && !document.documentElement.classList.contains("no-motion");
export type Dismiss = (after?: () => void) => void;

/** One overlay contract for quick menus and filters. A transient history entry
 * lets the phone's Back gesture dismiss the panel without losing the feed. */
export function Popup({ title, subtitle, onClose, children, className = "" }: {
  title: string; subtitle?: string; onClose: () => void;
  children: (dismiss: Dismiss) => ReactNode; className?: string;
}) {
  const id = useId(), panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const finish = useRef<() => void>(() => {});
  const requested = useRef(false);
  const closed = useRef(false);
  const ending = useRef(false), afterClose = useRef<(() => void) | undefined>(undefined);
  const dismiss: Dismiss = (after) => {
    if (ending.current || requested.current) {
      // A review request may finish after Close/Back. Its successful save still
      // has to refresh the detail, even when the exit animation already ended.
      if (after) { if (closed.current) after(); else afterClose.current ??= after; }
      return;
    }
    requested.current = true;
    afterClose.current = after;
    if (history.state?.[POPUP_KEY] === id) history.back();
    else finish.current();
  };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const app = document.querySelector<HTMLElement>(".app");
    const previousInert = app?.inert ?? false, overflow = document.body.style.overflow;
    const priorState = history.state;
    history.pushState({ ...priorState, [POPUP_KEY]: id }, "", location.href);
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";
    // Focus Close, not the first input: opening Filters should not summon the
    // phone keyboard and cover the options before a search was requested.
    panel.current?.querySelector<HTMLButtonElement>(".popup-close")?.focus({ preventScroll: true });
    let timer: ReturnType<typeof setTimeout>;
    finish.current = () => {
      if (ending.current) return;
      ending.current = true; setClosing(true);
      timer = setTimeout(() => {
        closed.current = true;
        if (app) app.inert = previousInert;
        document.body.style.overflow = overflow;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        closeRef.current(); afterClose.current?.();
      }, motionAllowed() ? 150 : 0);
    };
    const pop = () => finish.current();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      if (event.key !== "Tab") return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    addEventListener("popstate", pop); addEventListener("keydown", key);
    return () => {
      clearTimeout(timer); removeEventListener("popstate", pop); removeEventListener("keydown", key);
      if (app) app.inert = previousInert;
      document.body.style.overflow = overflow;
      // Session loss can unmount the dialog without a normal dismiss.
      if (history.state?.[POPUP_KEY] === id) history.replaceState(priorState, "", location.href);
    };
  }, [id]);
  return createPortal(<div className={`popup-backdrop ${className ? className + "-wrap" : ""}${closing ? " closing" : ""}`} onClick={e => { if (e.target === e.currentTarget) dismiss(); }}>
    <div ref={panel} className={`popup-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <header className="popup-head"><div><h2 id={`${id}-title`}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="popup-close" aria-label={`Close ${title.toLowerCase()}`} onClick={() => dismiss()}><Cross size={19} /></button></header>
      <div className="popup-content">{children(dismiss)}</div>
    </div>
  </div>, document.body);
}

export function MenuRow({ icon, label, detail, onClick, selected }: { icon?: ReactNode; label: string; detail?: string; onClick: () => void; selected?: boolean }) {
  return <button className={`quick-row${selected ? " selected" : ""}`} onClick={onClick} aria-pressed={selected}>
    {icon && <span className="quick-icon">{icon}</span>}<span><b>{label}</b>{detail && <small>{detail}</small>}</span><span className="quick-arrow" aria-hidden="true">{selected ? "✓" : "›"}</span>
  </button>;
}
