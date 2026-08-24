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
