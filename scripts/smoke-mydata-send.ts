/**
 * Live smoke: build invoice XML + SendInvoices to AADE test.
 * Usage: npx tsx scripts/smoke-mydata-send.ts [invoiceNumber]
 */
import { prisma } from "../src/server/db";
import { buildInvoiceInvoicesDocXml, readMyDataConfig } from "../src/modules/mydata/payload";
import { sendInvoicesXml } from "../src/modules/mydata/client";

const number = process.argv[2] ?? "ΤΙΜ-2026-20004";

async function main() {
  const invoice = await prisma.invoice.findFirst({
    where: { number },
    select: { id: true, tenantId: true, number: true, total: true },
  });
  if (!invoice) throw new Error(`Invoice not found: ${number}`);

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: invoice.tenantId },
    select: { integrationsJson: true },
  });
  const cfg = readMyDataConfig(settings?.integrationsJson);
  if (cfg.myDataEnv !== "test" && cfg.myDataEnv !== "prod") {
    throw new Error(`myDataEnv=${cfg.myDataEnv} — need test/prod`);
  }
  const userId = cfg.myDataUserId?.trim();
  const key = cfg.myDataSubscriptionKey?.trim();
  if (!userId || !key) throw new Error("Missing AADE credentials");

  const xml = await buildInvoiceInvoicesDocXml(prisma, {
    tenantId: invoice.tenantId,
    invoiceId: invoice.id,
  });

  const order = [...xml.matchAll(/<(issuer|counterpart|invoiceHeader|paymentMethods|invoiceDetails|invoiceSummary)\b/g)].map(
    (m) => m[1],
  );
  console.log("invoice", invoice.number, invoice.id);
  console.log("child order:", order.join(" → "));
  console.log("--- xml snippet ---");
  const pm = xml.indexOf("<paymentMethods>");
  console.log(xml.slice(Math.max(0, pm - 120), pm + 280));
  console.log("--- sending ---");

  const result = await sendInvoicesXml(cfg.myDataEnv, {
    userId,
    subscriptionKey: key,
  }, xml);

  console.log({
    ok: result.ok,
    status: result.status,
    mark: result.mark,
    uid: result.uid,
    errors: result.errors,
  });
  if (!result.ok) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
