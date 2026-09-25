export type CsvCell = string | number | null | undefined;

/** RFC 4180 CSV; also neutralises spreadsheet formula injection (`=`, `+`, `-`, `@`). */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const cell = (v: CsvCell): string => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
