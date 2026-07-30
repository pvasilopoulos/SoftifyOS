import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { pointsToEur } from "@/modules/pos/payable";

export const dynamic = "force-dynamic";

/** GET /api/pos/lookup?giftCard=CODE&customerId=... */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const giftCode = request.nextUrl.searchParams.get("giftCard")?.trim();
    const customerId = request.nextUrl.searchParams.get("customerId")?.trim();

    const result: {
      giftCard?: {
        id: string;
        code: string;
        balance: number;
        status: string;
        expiresAt: string | null;
      };
      loyalty?: {
        id: string;
        pointsBalance: number;
        maxRedeemEur: number;
        tier: string;
      };
    } = {};

    if (giftCode) {
      const card = await prisma.giftCard.findFirst({
        where: {
          tenantId: session.tenantId,
          code: giftCode.toUpperCase(),
        },
      });
      if (!card) {
        return NextResponse.json({ error: "Η δωροκάρτα δεν βρέθηκε" }, { status: 404 });
      }
      result.giftCard = {
        id: card.id,
        code: card.code,
        balance: toNumber(card.balance),
        status: card.status,
        expiresAt: card.expiresAt?.toISOString() ?? null,
      };
    }

    if (customerId) {
      const loyalty = await prisma.loyaltyAccount.findUnique({
        where: {
          tenantId_customerId: {
            tenantId: session.tenantId,
            customerId,
          },
        },
      });
      if (loyalty?.isActive) {
        result.loyalty = {
          id: loyalty.id,
          pointsBalance: loyalty.pointsBalance,
          maxRedeemEur: pointsToEur(loyalty.pointsBalance),
          tier: loyalty.tier,
        };
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Lookup failed") },
      { status: 500 },
    );
  }
}
