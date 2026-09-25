import { PRESETS } from './ranges';

export const SHORTCUTS: readonly [keys: string, description: string][] = [
  ['A / U', 'Analytics / Uptime view'],
  ...PRESETS.map((p): [string, string] => [p.key, p.label]),
  ['C', 'Custom range'],
  ['← / →', 'Previous / next period'],
  ['S', 'Next site'],
  ['V', 'Toggle visitors / pageviews chart'],
  ['/', 'Filter top pages'],
  ['E', 'Export top pages as CSV'],
  ['L', 'Pause / resume live updates'],
  ['?', 'Show this help'],
  ['Esc', 'Close dialogs'],
];
