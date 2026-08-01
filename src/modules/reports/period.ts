import type { ReportRunInput } from "./schemas";

export function resolvePeriod(period: ReportRunInput["period"]) {
  const now = new Date();
  const end = new Date(now);
  let start: Date;
  let label: string;
  switch (period) {
    case "mtd": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      label = "Τρέχων μήνας";
      break;
    }
    case "qtd": {
      const q = Math.floor(now.getUTCMonth() / 3) * 3;
      start = new Date(Date.UTC(now.getUTCFullYear(), q, 1));
      label = "Τρέχον τρίμηνο";
      break;
    }
    case "12m": {
      start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
      );
      label = "12 μήνες";
      break;
    }
    case "ytd":
    default: {
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      label = "Έτος έως σήμερα";
      break;
    }
  }
  return { start, end, label };
}
