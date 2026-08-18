export type TableRow = Record<string, string>;

function stripBom(text: string) {
  return text.replace(/^\uFEFF/, "");
}

function parseCsv(text: string): TableRow[] {
  const src = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const out: TableRow = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      out[header] = (values[idx] ?? "").trim();
    });
    return out;
  });
}

export async function parseTableBuffer(
  buffer: ArrayBuffer | Buffer,
  filename: string,
): Promise<TableRow[]> {
  const name = filename.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    return json.map((row) => {
      const out: TableRow = {};
      for (const [key, value] of Object.entries(row)) {
        out[String(key).trim()] = String(value ?? "").trim();
      }
      return out;
    });
  }

  const text =
    typeof buffer === "string"
      ? buffer
      : Buffer.isBuffer(buffer)
        ? buffer.toString("utf8")
        : new TextDecoder("utf-8").decode(buffer);
  return parseCsv(text);
}

export function parseBool(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "ναι", "ΝΑΙ", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "όχι", "οχι", "off"].includes(v)) return false;
  return fallback;
}

export function parseNumber(value: string | undefined, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function cell(row: TableRow, ...keys: string[]) {
  for (const key of keys) {
    const match = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] != null && String(row[match]).trim() !== "") {
      return String(row[match]).trim();
    }
  }
  return "";
}
