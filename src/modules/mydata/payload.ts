import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { escapeXml } from "./client";

type Db = PrismaClient | Prisma.TransactionClient;

/** AADE keeps the typo "Classificaton" in official XSD namespaces. */
const NS_INVOICE = "http://www.aade.gr/myDATA/invoice/v1.0";
const NS_INCOME = "https://www.aade.gr/myDATA/incomeClassificaton/v1.0";
const NS_EXPENSES = "https://www.aade.gr/myDATA/expensesClassificaton/v1.0";

function invoicesDocOpen() {
  return `<InvoicesDoc xmlns="${NS_INVOICE}" xmlns:icls="${NS_INCOME}" xmlns:ecls="${NS_EXPENSES}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`;
}

function incomeClassificationXml(input: {
  classificationType: string;
  classificationCategory: string;
  amount: number;
}) {
  return `<incomeClassification>
    <icls:classificationType>${escapeXml(input.classificationType)}</icls:classificationType>
    <icls:classificationCategory>${escapeXml(input.classificationCategory)}</icls:classificationCategory>
    <icls:amount>${input.amount.toFixed(2)}</icls:amount>
  </incomeClassification>`;
}

function expensesClassificationXml(input: {
  classificationType: string;
  classificationCategory: string;
  amount: number;
}) {
  return `<expensesClassification>
    <ecls:classificationType>${escapeXml(input.classificationType)}</ecls:classificationType>
    <ecls:classificationCategory>${escapeXml(input.classificationCategory)}</ecls:classificationCategory>
    <ecls:amount>${input.amount.toFixed(2)}</ecls:amount>
  </expensesClassification>`;
}

/** AADE PartyType: GR counterparts must not include name (error 220). */
function counterpartXml(input: {
  vatNumber: string;
  country?: string | null;
  name?: string | null;
  issuerVat?: string | null;
}) {
  const vat = (input.vatNumber || "").replace(/\s/g, "");
  if (vat.length < 9) return "";
  const country = (input.country || "GR").toUpperCase();
  const issuerVat = (input.issuerVat || "").replace(/\s/g, "");
  if (issuerVat && vat === issuerVat) {
    throw new Error(
      "Το ΑΦΜ πελάτη/προμηθευτή πρέπει να διαφέρει από το ΑΦΜ επιχείρησης (ΑΑΔΕ 235)",
    );
  }
  const nameXml =
    country === "GR" || !input.name?.trim()
      ? ""
      : `\n  <name>${escapeXml(input.name.trim())}</name>`;
  return `<counterpart>
  <vatNumber>${escapeXml(vat)}</vatNumber>
  <country>${escapeXml(country)}</country>
  <branch>0</branch>${nameXml}
</counterpart>`;
}

/**
 * AADE payment method type codes (table 8.12).
 * 1 domestic account · 3 cash · 5 on credit · 6 web banking · 7 POS
 */
function mapPaymentKindToAadeType(
  kind: string | null | undefined,
  methodCode?: string | null,
): number {
  const k = (kind || "").toUpperCase();
  const code = (methodCode || "").toUpperCase();
  if (k === "CASH" || code === "CASH") return 3;
  if (k === "CARD" || code.includes("CARD") || code.includes("POS")) return 7;
  if (k === "TRANSFER" || code.includes("TRANSFER") || code.includes("BANK"))
    return 6;
  if (k === "GIFT_CARD" || k === "LOYALTY") return 5;
  return 5;
}

function paymentMethodsXml(
  rows: Array<{ type: number; amount: number; info?: string | null }>,
) {
  if (rows.length === 0) return "";
  const details = rows
    .filter((r) => r.amount > 0)
    .map((r) => {
      const info = r.info?.trim()
        ? `\n    <paymentMethodInfo>${escapeXml(r.info.trim())}</paymentMethodInfo>`
        : "";
      return `<paymentMethodDetails>
    <type>${r.type}</type>
    <amount>${r.amount.toFixed(2)}</amount>${info}
  </paymentMethodDetails>`;
    })
    .join("\n  ");
  if (!details) return "";
  return `<paymentMethods>
  ${details}
</paymentMethods>`;
}

/** Types that AADE requires paymentMethods on SendInvoices (e.g. 1.1). */
function requiresPaymentMethods(invoiceType: string) {
  const t = invoiceType.trim();
  return /^(1\.|2\.|5\.|11\.)/.test(t);
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function resolveIssuer(
  db: Db,
  input: { tenantId: string; legalEntityId?: string | null },
) {
  const [settings, legalEntity] = await Promise.all([
    db.tenantSettings.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        legalName: true,
        vatNumber: true,
        country: true,
      },
    }),
    input.legalEntityId
      ? db.legalEntity.findFirst({
          where: { id: input.legalEntityId, tenantId: input.tenantId },
          select: { vatNumber: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const issuerVat = (
    legalEntity?.vatNumber ||
    settings?.vatNumber ||
    ""
  ).replace(/\s/g, "");
  if (!issuerVat) {
    throw new Error(
      "Λείπει ΑΦΜ επιχείρησης (νομική οντότητα ή Ρυθμίσεις) για myDATA",
    );
  }

  return {
    issuerVat,
    country: settings?.country || "GR",
    legalName: legalEntity?.name || settings?.legalName || "",
  };
}

function defaultSalesInvoiceType(kind: string | null | undefined) {
  if (kind === "SALES_CREDIT") return "5.1";
  if (kind === "RETAIL_RECEIPT") return "11.1";
  return "1.1";
}

/** Build AADE InvoicesDoc XML from SoftifyOS invoice (+ LE / company settings). */
export async function buildInvoiceInvoicesDocXml(
  db: Db,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceType?: string | null;
    vatCategory?: string | null;
  },
): Promise<string> {
  const invoice = await db.invoice.findFirst({
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
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          amount: true,
          method: true,
          note: true,
          paymentMethod: { select: { kind: true, code: true, name: true } },
        },
      },
    },
  });

  if (!invoice) {
    throw new Error("Τιμολόγιο δεν βρέθηκε για myDATA payload");
  }

  const issuer = await resolveIssuer(db, {
    tenantId: input.tenantId,
    legalEntityId: invoice.legalEntityId,
  });

  const invoiceType =
    input.invoiceType ||
    invoice.series?.myDataInvoiceType ||
    defaultSalesInvoiceType(invoice.kind);
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
  ${incomeClassificationXml({
    classificationType: "E3_561_001",
    classificationCategory: "category1_1",
    amount: lineNet,
  })}
</invoiceDetails>`;
    })
    .join("\n");

  const counterpart = counterpartXml({
    vatNumber: counterVat,
    country: invoice.customer?.country || "GR",
    name: invoice.customer?.name,
    issuerVat: issuer.issuerVat,
  });

  const paymentRows =
    invoice.payments.length > 0
      ? invoice.payments.map((p) => ({
          type: mapPaymentKindToAadeType(
            p.paymentMethod?.kind ?? null,
            p.paymentMethod?.code ?? p.method,
          ),
          amount: round2(Number(p.amount)),
          info: p.note || p.paymentMethod?.name || p.method,
        }))
      : requiresPaymentMethods(invoiceType)
        ? [{ type: 5, amount: total, info: "Επί πιστώσει" }]
        : [];
  const paymentsXml = paymentMethodsXml(paymentRows);

  return `<?xml version="1.0" encoding="UTF-8"?>
${invoicesDocOpen()}
  <invoice>
    <issuer>
      <vatNumber>${escapeXml(issuer.issuerVat)}</vatNumber>
      <country>${escapeXml(issuer.country)}</country>
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
      ${incomeClassificationXml({
        classificationType: "E3_561_001",
        classificationCategory: "category1_1",
        amount: net,
      })}
    </invoiceSummary>
    ${paymentsXml}
  </invoice>
</InvoicesDoc>`;
}

/** Delivery note → myDATA type 9.3 (goods movement). */
export async function buildDeliveryNoteInvoicesDocXml(
  db: Db,
  input: {
    tenantId: string;
    deliveryNoteId: string;
    invoiceType?: string | null;
  },
): Promise<string> {
  const note = await db.deliveryNote.findFirst({
    where: { id: input.deliveryNoteId, tenantId: input.tenantId },
    include: {
      customer: {
        select: { name: true, vatNumber: true, country: true },
      },
      series: {
        select: { code: true, myDataInvoiceType: true },
      },
      lines: {
        orderBy: { position: "asc" },
        select: { description: true, quantity: true },
      },
    },
  });
  if (!note) throw new Error("Δελτίο αποστολής δεν βρέθηκε για myDATA");

  const issuer = await resolveIssuer(db, {
    tenantId: input.tenantId,
    legalEntityId: note.legalEntityId,
  });

  const invoiceType =
    input.invoiceType || note.series?.myDataInvoiceType || "9.3";
  const seriesCode = note.series?.code || "ΔΑ";
  const aaMatch = note.number.match(/(\d+)\s*$/);
  const aa = aaMatch ? Number(aaMatch[1]) : 1;
  const issueDate = fmtDate(note.issuedAt ?? note.createdAt);
  const counterVat = (note.customer?.vatNumber || "").replace(/\s/g, "");

  const lineXml = (note.lines.length ? note.lines : [{ description: "Μεταφορά", quantity: 1 }])
    .map((l, idx) => {
      return `<invoiceDetails>
  <lineNumber>${idx + 1}</lineNumber>
  <netValue>0.00</netValue>
  <vatCategory>8</vatCategory>
  <vatAmount>0.00</vatAmount>
  <quantity>${Number(l.quantity).toFixed(3)}</quantity>
  ${incomeClassificationXml({
    classificationType: "E3_561_001",
    classificationCategory: "category1_1",
    amount: 0,
  })}
</invoiceDetails>`;
    })
    .join("\n");

  const counterpart = counterpartXml({
    vatNumber: counterVat,
    country: note.customer?.country || "GR",
    name: note.customer?.name,
    issuerVat: issuer.issuerVat,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
${invoicesDocOpen()}
  <invoice>
    <issuer>
      <vatNumber>${escapeXml(issuer.issuerVat)}</vatNumber>
      <country>${escapeXml(issuer.country)}</country>
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
      <totalNetValue>0.00</totalNetValue>
      <totalVatAmount>0.00</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>0.00</totalGrossValue>
      ${incomeClassificationXml({
        classificationType: "E3_561_001",
        classificationCategory: "category1_1",
        amount: 0,
      })}
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`;
}

/** Purchase invoice → expense classification for AADE. */
export async function buildPurchaseInvoiceInvoicesDocXml(
  db: Db,
  input: {
    tenantId: string;
    purchaseInvoiceId: string;
    invoiceType?: string | null;
    vatCategory?: string | null;
  },
): Promise<string> {
  const pi = await db.purchaseInvoice.findFirst({
    where: { id: input.purchaseInvoiceId, tenantId: input.tenantId },
    include: {
      supplier: {
        select: { name: true, vatNumber: true },
      },
      lines: {
        orderBy: { lineNo: "asc" },
        select: {
          description: true,
          netAmount: true,
          vatAmount: true,
          vatRate: true,
        },
      },
    },
  });
  if (!pi) throw new Error("Τιμολόγιο αγοράς δεν βρέθηκε για myDATA");

  const issuer = await resolveIssuer(db, {
    tenantId: input.tenantId,
    legalEntityId: pi.legalEntityId,
  });

  const invoiceType = input.invoiceType || "14.1";
  const vatCategory = input.vatCategory || "1";
  const aaMatch = pi.number.match(/(\d+)\s*$/);
  const aa = aaMatch ? Number(aaMatch[1]) : 1;
  const issueDate = fmtDate(pi.issueDate);
  const counterVat = (pi.supplier?.vatNumber || "").replace(/\s/g, "");
  const net = round2(Number(pi.netAmount));
  const vat = round2(Number(pi.vatAmount));
  const total = round2(Number(pi.total));

  const lineXml = pi.lines
    .map((l, idx) => {
      const lineNet = round2(Number(l.netAmount));
      const lineVat = round2(Number(l.vatAmount));
      return `<invoiceDetails>
  <lineNumber>${idx + 1}</lineNumber>
  <netValue>${lineNet.toFixed(2)}</netValue>
  <vatCategory>${escapeXml(vatCategory)}</vatCategory>
  <vatAmount>${lineVat.toFixed(2)}</vatAmount>
  ${expensesClassificationXml({
    classificationType: "E3_102_001",
    classificationCategory: "category2_1",
    amount: lineNet,
  })}
</invoiceDetails>`;
    })
    .join("\n");

  const counterpart = counterpartXml({
    vatNumber: counterVat,
    country: "GR",
    name: pi.supplier?.name,
    issuerVat: issuer.issuerVat,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
${invoicesDocOpen()}
  <invoice>
    <issuer>
      <vatNumber>${escapeXml(issuer.issuerVat)}</vatNumber>
      <country>${escapeXml(issuer.country)}</country>
      <branch>0</branch>
    </issuer>
    ${counterpart}
    <invoiceHeader>
      <series>ΑΓ</series>
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
      ${expensesClassificationXml({
        classificationType: "E3_102_001",
        classificationCategory: "category2_1",
        amount: net,
      })}
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
