/** Tiny CSV helper (semicolon, Excel-friendly EL). */
export function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(
  rows: Array<Array<string | number | null | undefined>>,
) {
  return `${rows.map((r) => r.map(csvEscape).join(";")).join("\n")}\n`;
}

export function downloadCsvClient(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
