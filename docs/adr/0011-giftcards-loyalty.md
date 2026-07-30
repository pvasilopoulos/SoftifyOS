# ADR 0011 — Gift cards & Loyalty modules

## Status
Accepted — 2026-07-30

## Context
POS already redeemed gift cards and loyalty points at checkout, but there was
no back-office for issuing cards, adjusting balances, viewing ledgers, or
configuring earn/redeem rates.

## Decision
- **Gift cards** (`/gift-cards`): issue, list, detail, adjust (±), void;
  every mutation writes `GiftCardLedger` (ISSUE/REDEEM/ADJUST/VOID/EXPIRE).
- **Loyalty** (`/loyalty`): accounts per customer, ledger UI, manual ADJUST,
  activate/deactivate, tier; `/loyalty/program` holds tenant `LoyaltyProgram`
  (earn pts/€, redeem pts per €).
- POS checkout/lookup call shared services in `src/modules/gift-cards` and
  `src/modules/loyalty` so redeem/earn stay single-sourced with rates from
  `LoyaltyProgram` (fallback to defaults 1 pts/€ earn, 100 pts = 1 €).

## Consequences
Sidebar Πωλήσεις includes Δωροκάρτες and Loyalty. Permissions:
`gift_cards.read/write`, `loyalty.read/write`. ADR 0010 POS foundation remains
the cashier lane; this ADR owns the master-data / ops modules.

## Addendum — Gift card accounting & balance integrity (2026-07-30)
- Each gift card stores GL accounts: liability (παθητικό), cash (έκδοση),
  redeem contra (εξαργύρωση), plus optional cost center / accounting code.
- Every ledger row snapshots `glDebitAccount` / `glCreditAccount`.
- POS redeem uses atomic `UPDATE … WHERE balance >= amount` and clamps
  tender amounts to the payable gift application so balances stay correct
  under concurrency and over-application.
