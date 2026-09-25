const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  if (code === 'ZZ') return 'Unknown';
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Regional-indicator flag emoji, e.g. "DE" → 🇩🇪. */
export function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
