/**
 * Regression: AADE InvoicesDoc child order for paymentMethods.
 * Official XSD (InvoicesDoc-v1.0.10): invoiceHeader → paymentMethods → invoiceDetails
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractAadeInvoiceChildOrder } from "../src/modules/mydata/payload";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <invoice>
    <issuer><vatNumber>1</vatNumber><country>GR</country><branch>0</branch></issuer>
    <counterpart><vatNumber>2</vatNumber><country>GR</country><branch>0</branch></counterpart>
    <invoiceHeader><series>A</series><aa>1</aa><issueDate>2026-01-01</issueDate><invoiceType>1.1</invoiceType><currency>EUR</currency></invoiceHeader>
    <paymentMethods><paymentMethodDetails><type>3</type><amount>10.00</amount></paymentMethodDetails></paymentMethods>
    <invoiceDetails><lineNumber>1</lineNumber><netValue>8.06</netValue><vatCategory>1</vatCategory><vatAmount>1.94</vatAmount></invoiceDetails>
    <invoiceSummary><totalNetValue>8.06</totalNetValue><totalVatAmount>1.94</totalVatAmount><totalWithheldAmount>0</totalWithheldAmount><totalFeesAmount>0</totalFeesAmount><totalStampDutyAmount>0</totalStampDutyAmount><totalOtherTaxesAmount>0</totalOtherTaxesAmount><totalDeductionsAmount>0</totalDeductionsAmount><totalGrossValue>10.00</totalGrossValue></invoiceSummary>
  </invoice>
</InvoicesDoc>`;

const order = extractAadeInvoiceChildOrder(SAMPLE);
const expected = [
  "issuer",
  "counterpart",
  "invoiceHeader",
  "paymentMethods",
  "invoiceDetails",
  "invoiceSummary",
];
if (JSON.stringify(order) !== JSON.stringify(expected)) {
  console.error("FAIL order", order, "expected", expected);
  process.exit(1);
}

const src = readFileSync(
  resolve(import.meta.dirname, "../src/modules/mydata/payload.ts"),
  "utf8",
);
const fnStart = src.indexOf("export async function buildInvoiceInvoicesDocXml");
const fnEnd = src.indexOf(
  "export async function buildDeliveryNoteInvoicesDocXml",
);
const fn = src.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
const headerIdx = fn.indexOf("<invoiceHeader>");
const paymentsIdx = fn.indexOf("${paymentsXml}");
const detailsIdx = fn.indexOf("${lineXml}");
const summaryIdx = fn.indexOf("<invoiceSummary>");
if (
  headerIdx < 0 ||
  paymentsIdx < 0 ||
  detailsIdx < 0 ||
  !(
    headerIdx < paymentsIdx &&
    paymentsIdx < detailsIdx &&
    detailsIdx < summaryIdx
  )
) {
  console.error(
    "FAIL buildInvoiceInvoicesDocXml paymentsXml not between header and lineXml",
    { headerIdx, paymentsIdx, detailsIdx, summaryIdx },
  );
  process.exit(1);
}

console.log("OK myDATA paymentMethods order (XSD + payload.ts)");
