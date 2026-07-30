import { roundMoney } from "@/modules/sales/invoice-utils";
import {
  DEFAULT_EARN_POINTS_PER_EUR,
  DEFAULT_REDEEM_POINTS_PER_EUR,
} from "./labels";

export type LoyaltyRules = {
  earnPointsPerEur: number;
  redeemPointsPerEur: number;
};

export const defaultLoyaltyRules: LoyaltyRules = {
  earnPointsPerEur: DEFAULT_EARN_POINTS_PER_EUR,
  redeemPointsPerEur: DEFAULT_REDEEM_POINTS_PER_EUR,
};

export function pointsToEur(points: number, rules: LoyaltyRules = defaultLoyaltyRules) {
  if (rules.redeemPointsPerEur <= 0) return 0;
  return roundMoney(points / rules.redeemPointsPerEur);
}

export function eurToRedeemPoints(
  amountEur: number,
  rules: LoyaltyRules = defaultLoyaltyRules,
) {
  return Math.floor(roundMoney(amountEur) * rules.redeemPointsPerEur);
}

export function earnPointsForSale(
  totalEur: number,
  rules: LoyaltyRules = defaultLoyaltyRules,
) {
  return Math.floor(roundMoney(totalEur) * rules.earnPointsPerEur);
}
