/**
 * Inline SVG icons, single family, 1.75 stroke, 24px grid.
 * Never emoji — they're font-dependent, inconsistent across platforms, and
 * can't be driven by design tokens.
 */
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type P = { size?: number; className?: string };
const svg = (size: number, kids: React.ReactNode, cls?: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={cls} aria-hidden="true" {...base}>
    {kids}
  </svg>
);

export const Scan = ({ size = 22, className }: P) =>
  svg(size, <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>, className);

export const Clock = ({ size = 22, className }: P) =>
  svg(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, className);

export const User = ({ size = 22, className }: P) =>
  svg(size, <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, className);

export const Alert = ({ size = 13, className }: P) =>
  svg(size, <><path d="M12 8v5" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none" /><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>, className);

export const Check = ({ size = 13, className }: P) =>
  svg(size, <path d="m4 12.5 5.5 5.5L20 7" />, className);

export const Info = ({ size = 13, className }: P) =>
  svg(size, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r=".6" fill="currentColor" stroke="none" /></>, className);

export const Link = ({ size = 16, className }: P) =>
  svg(size, <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>, className);

export const Again = ({ size = 16, className }: P) =>
  svg(size, <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>, className);

export const Eye = ({ size = 18, className }: P) =>
  svg(size, <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>, className);

export const Shield = ({ size = 18, className }: P) =>
  svg(size, <><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>, className);

export const Tag = ({ size = 18, className }: P) =>
  svg(size, <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.2" /></>, className);

export const Ghost = ({ size = 40, className }: P) =>
  svg(size, <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M8 12h8" /></>, className);

/** Clipboard — the paste-and-check action on the Check screen. */
export const Clip = ({ size = 22, className }: P) =>
  svg(size, <><rect x="8" y="3" width="8" height="4" rx="1.5" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /><path d="M9 13h6M9 17h4" /></>, className);

/** Bookmark — save to the watchlist. Filled variant when saved. */
export const Save = ({ size = 22, className, filled }: P & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
    {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" />
  </svg>
);

/** Grid — the deals feed tab. */
export const Grid = ({ size = 22, className }: P) =>
  svg(size, <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>, className);

/** Gear — settings. */
export const Gear = ({ size = 22, className }: P) =>
  svg(size, <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" /></>, className);

/** Down arrow in a circle — a price cut. */
export const Cut = ({ size = 22, className }: P) =>
  svg(size, <><path d="M12 5v13" /><path d="m6.5 12.5 5.5 5.5 5.5-5.5" /></>, className);

/**
 * Sliders — filters.
 *
 * The Filters button borrowed `Cut`, a DOWN ARROW that means "the price
 * dropped" everywhere else in the app. At 375px the button's label is hidden
 * to save 60px, so that arrow was the entire control: a filter button that
 * reads as sort, or download, or "jump to bottom". Two icons for two meanings.
 */
export const Sliders = ({ size = 22, className }: P) =>
  svg(size, <>
    <path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" />
    <path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" />
    <path d="M4 18h10" /><path d="M18 18h2" /><circle cx="16" cy="18" r="2" />
  </>, className);

/** Bell — alerts and saved searches. */
export const Bell = ({ size = 22, className }: P) =>
  svg(size, <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></>, className);

/** Storefront — the new-retail ceiling, the one price not from the comps. */
export const Store = ({ size = 18, className }: P) =>
  svg(size, <><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M3 9h18l-1.6-4.4A1 1 0 0 0 18.5 4h-13a1 1 0 0 0-.9.6L3 9Z" /><path d="M9 20v-6h6v6" /></>, className);

/** Speech bubble — the questions to ask before you drive. */
export const Chat = ({ size = 18, className }: P) =>
  svg(size, <><path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></>, className);

/**
 * Left arrow — back.
 *
 * ⚠ NOT A CHEVRON. The overlay sits on an arbitrary product photo, and a bare
 * `<` at 1.75 stroke disappears against detail. A shafted arrow keeps a
 * recognisable silhouette at 20px over anything.
 */
export const Back = ({ size = 20, className }: P) =>
  svg(size, <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>, className);

/** Card — billing. */
export const Card = ({ size = 22, className }: P) =>
  svg(size, <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6 15h3" /></>, className);
