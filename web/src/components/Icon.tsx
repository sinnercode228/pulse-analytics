import type { SVGProps } from 'react';

const PATHS = {
  logo: 'M3 12h4l2.5-6 4 13 3-9 1.5 2H21',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 4 4',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5v14l11-7z',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 5v14m0 0-6-6m6 6 6-6',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
