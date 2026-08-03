/**
 * Re-process REJECTED myDATA submissions (e.g. after XML order fix).
 * Usage: npx tsx scripts/reprocess-rejected-mydata.ts [tenantId?]
 */
import { prisma } from "../src/server/db";
import { processMyDataSubmission } from "../src/modules/mydata/service";

async function main() {
  const tenantArg = process.argv[2];
  const where = {
    status: "REJECTED" as const,
    ...(tenantArg ? { tenantId: tenantArg } : {}),
  };

  const rejected = await prisma.myDataSubmission.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tenantId: true,
      entityNumber: true,
      errorMessage: true,
    },
  });

  console.log(`Found ${rejected.length} REJECTED submission(s)`);
  if (rejected.length === 0) return;

  for (const row of rejected) {
    process.stdout.write(
      `→ ${row.entityNumber || row.id.slice(0, 8)} … `,
    );
    try {
      const result = await processMyDataSubmission(prisma, {
        tenantId: row.tenantId,
        id: row.id,
      });
      const err = result.errorMessage
        ? result.errorMessage.slice(0, 160)
        : null;
      console.log(
        `${result.status}${result.mark ? ` mark=${result.mark}` : ""}${
          err ? ` · ${err}` : ""
        }`,
      );
    } catch (e) {
      console.log(
        `ERROR ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
