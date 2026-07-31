export type PrintPaperPreset =
  | "A4"
  | "A5"
  | "A3"
  | "LETTER"
  | "RECEIPT_80"
  | "CUSTOM";

export type PrintOrientationValue = "PORTRAIT" | "LANDSCAPE";

export type PrintPageSettings = {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
};

export const PAPER_PRESETS: Record<
  Exclude<PrintPaperPreset, "CUSTOM">,
  { label: string; widthMm: number; heightMm: number }
> = {
  A4: { label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297 },
  A5: { label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210 },
  A3: { label: "A3 (297 × 420 mm)", widthMm: 297, heightMm: 420 },
  LETTER: { label: "Letter (216 × 279 mm)", widthMm: 216, heightMm: 279 },
  RECEIPT_80: {
    label: "Απόδειξη 80 mm",
    widthMm: 80,
    heightMm: 297,
  },
};

export const DEFAULT_PAGE_SETTINGS: PrintPageSettings = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 12,
  marginRightMm: 12,
  marginBottomMm: 12,
  marginLeftMm: 12,
};

function clampMm(n: unknown, fallback: number, min = 0, max = 2000): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100));
}

export function normalizePageSettings(
  raw?: Partial<PrintPageSettings> | null,
): PrintPageSettings {
  return {
    widthMm: clampMm(raw?.widthMm, DEFAULT_PAGE_SETTINGS.widthMm, 40, 2000),
    heightMm: clampMm(raw?.heightMm, DEFAULT_PAGE_SETTINGS.heightMm, 40, 2000),
    marginTopMm: clampMm(raw?.marginTopMm, DEFAULT_PAGE_SETTINGS.marginTopMm, 0, 80),
    marginRightMm: clampMm(
      raw?.marginRightMm,
      DEFAULT_PAGE_SETTINGS.marginRightMm,
      0,
      80,
    ),
    marginBottomMm: clampMm(
      raw?.marginBottomMm,
      DEFAULT_PAGE_SETTINGS.marginBottomMm,
      0,
      80,
    ),
    marginLeftMm: clampMm(
      raw?.marginLeftMm,
      DEFAULT_PAGE_SETTINGS.marginLeftMm,
      0,
      80,
    ),
  };
}

export function pageFromPaperPreset(
  paper: string,
  orientation: string = "PORTRAIT",
  overrides?: Partial<PrintPageSettings> | null,
): PrintPageSettings {
  const base = normalizePageSettings(overrides);
  if (paper === "CUSTOM") return base;

  const preset =
    PAPER_PRESETS[paper as Exclude<PrintPaperPreset, "CUSTOM">] ??
    PAPER_PRESETS.A4;

  let widthMm = preset.widthMm;
  let heightMm = preset.heightMm;
  if (orientation === "LANDSCAPE" && paper !== "RECEIPT_80") {
    widthMm = preset.heightMm;
    heightMm = preset.widthMm;
  }

  return {
    ...base,
    widthMm,
    heightMm,
  };
}

export function resolvePageSettings(input: {
  paper: string;
  orientation?: string;
  page?: Partial<PrintPageSettings> | null;
}): PrintPageSettings {
  const orientation = input.orientation ?? "PORTRAIT";
  if (input.paper === "CUSTOM" || input.page?.widthMm || input.page?.heightMm) {
    // When custom dims present, prefer stored page box but still apply preset if paper known and page incomplete
    if (input.paper === "CUSTOM") {
      return normalizePageSettings(input.page);
    }
    return pageFromPaperPreset(input.paper, orientation, input.page);
  }
  return pageFromPaperPreset(input.paper, orientation, input.page);
}

/** CSS for @page + optional screen sheet sizing */
export function buildPageCss(page: PrintPageSettings): string {
  const p = normalizePageSettings(page);
  return `
@page {
  size: ${p.widthMm}mm ${p.heightMm}mm;
  margin: ${p.marginTopMm}mm ${p.marginRightMm}mm ${p.marginBottomMm}mm ${p.marginLeftMm}mm;
}
html, body {
  margin: 0;
  padding: 0;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: #0f172a;
  font-size: 12px;
}
* { box-sizing: border-box; }
@media screen {
  body {
    background: #e2e8f0;
    padding: 16px;
  }
  .softify-sheet, .sheet, .receipt {
    background: #fff;
    margin: 0 auto;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  }
  .softify-sheet, .sheet {
    width: ${p.widthMm}mm;
    min-height: ${p.heightMm}mm;
    padding: ${p.marginTopMm}mm ${p.marginRightMm}mm ${p.marginBottomMm}mm ${p.marginLeftMm}mm;
  }
  .receipt {
    width: ${Math.min(p.widthMm, 80)}mm;
    min-height: auto;
    padding: ${p.marginTopMm}mm ${p.marginRightMm}mm ${p.marginBottomMm}mm ${p.marginLeftMm}mm;
  }
}
@media print {
  body { background: #fff; padding: 0; }
  .softify-sheet, .sheet, .receipt {
    width: auto;
    min-height: auto;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }
}
`.trim();
}

export function pageLabel(paper: string, page: PrintPageSettings): string {
  const p = normalizePageSettings(page);
  return `${paper} · ${p.widthMm}×${p.heightMm} mm`;
}
