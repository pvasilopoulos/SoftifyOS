import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { escapeXml } from "./client";

type Db = PrismaClient | Prisma.TransactionClient;

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Build AADE InvoicesDoc XML from SoftifyOS invoice (+ company settings). */
export async function buildInvoiceInvoicesDocXml(
  db: Db,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceType?: string | null;
    vatCategory?: string | null;
  },
): Promise<string> {
  const [invoice, settings] = await Promise.all([
    db.invoice.findFirst({
      where: { id: input.invoiceId, tenantId: input.tenantId },
      include: {
        customer: {
          select: {
            name: true,
            vatNumber: true,
            country: true,
          },
        },
        series: {
          select: {
            code: true,
            myDataInvoiceType: true,
            myDataVatCategory: true,
          },
        },
        lines: {
          orderBy: { position: "asc" },
          select: {
            quantity: true,
            unitPrice: true,
            vatRate: true,
            lineTotal: true,
          },
        },
      },
    }),
    db.tenantSettings.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        legalName: true,
        vatNumber: true,
        country: true,
      },
    }),
  ]);

  if (!invoice) {
    throw new Error("Τιμολόγιο δεν βρέθηκε για myDATA payload");
  }

  const issuerVat = (settings?.vatNumber || "").replace(/\s/g, "");
  if (!issuerVat) {
    throw new Error("Λείπει ΑΦΜ επιχείρησης (Ρυθμίσεις εταιρείας) για myDATA");
  }

  const invoiceType =
    input.invoiceType ||
    invoice.series?.myDataInvoiceType ||
    (invoice.kind === "SALES_CREDIT" ? "5.1" : "1.1");
  const vatCategory =
    input.vatCategory || invoice.series?.myDataVatCategory || "1";

  const seriesCode = invoice.series?.code || "Α";
  const aaMatch = invoice.number.match(/(\d+)\s*$/);
  const aa = aaMatch ? Number(aaMatch[1]) : 1;
  const issueDate = fmtDate(invoice.issuedAt ?? invoice.createdAt);
  const counterVat = (invoice.customer?.vatNumber || "").replace(/\s/g, "");
  const net = round2(Number(invoice.total) - Number(invoice.vatAmount));
  const vat = round2(Number(invoice.vatAmount));
  const total = round2(Number(invoice.total));

  const lineXml = invoice.lines
    .map((l, idx) => {
      const gross = round2(Number(l.lineTotal));
      const rate = Number(l.vatRate) || 0;
      const lineNet = round2(gross / (1 + rate / 100));
      const lineVat = round2(gross - lineNet);
      return `<invoiceDetails>
  <lineNumber>${idx + 1}</lineNumber>
  <netValue>${lineNet.toFixed(2)}</netValue>
  <vatCategory>${escapeXml(vatCategory)}</vatCategory>
  <vatAmount>${lineVat.toFixed(2)}</vatAmount>
  <incomeClassification>
    <classificationType>E3_561_001</classificationType>
    <classificationCategory>category1_1</classificationCategory>
    <amount>${lineNet.toFixed(2)}</amount>
  </incomeClassification>
</invoiceDetails>`;
    })
    .join("\n");

  const counterpart =
    counterVat.length >= 9
      ? `<counterpart>
  <vatNumber>${escapeXml(counterVat)}</vatNumber>
  <country>${escapeXml(invoice.customer?.country || "GR")}</country>
  <branch>0</branch>
  <name>${escapeXml(invoice.customer?.name || "")}</name>
</counterpart>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <invoice>
    <issuer>
      <vatNumber>${escapeXml(issuerVat)}</vatNumber>
      <country>${escapeXml(settings?.country || "GR")}</country>
      <branch>0</branch>
    </issuer>
    ${counterpart}
    <invoiceHeader>
      <series>${escapeXml(seriesCode)}</series>
      <aa>${aa}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>${escapeXml(invoiceType)}</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
    ${lineXml}
    <invoiceSummary>
      <totalNetValue>${net.toFixed(2)}</totalNetValue>
      <totalVatAmount>${vat.toFixed(2)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${total.toFixed(2)}</totalGrossValue>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`;
}

export type MyDataConfig = {
  myDataEnv: "simulator" | "test" | "prod";
  myDataUserId?: string | null;
  myDataSubscriptionKey?: string | null;
};

export function readMyDataConfig(
  integrationsJson: Prisma.JsonValue | null | undefined,
): MyDataConfig {
  const json =
    integrationsJson &&
    typeof integrationsJson === "object" &&
    !Array.isArray(integrationsJson)
      ? (integrationsJson as Record<string, unknown>)
      : {};
  const env = json.myDataEnv;
  return {
    myDataEnv:
      env === "test" || env === "prod" || env === "simulator"
        ? env
        : "simulator",
    myDataUserId:
      typeof json.myDataUserId === "string" ? json.myDataUserId : null,
    myDataSubscriptionKey:
      typeof json.myDataSubscriptionKey === "string"
        ? json.myDataSubscriptionKey
        : null,
  };
}
