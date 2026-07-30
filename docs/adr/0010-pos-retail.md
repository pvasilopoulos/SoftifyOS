# ADR 0010 — POS & λιανική (foundation)

## Status
Accepted — 2026-07-30

## Context
SoftifyOS needs a retail / POS lane: multi-tender payments, till sessions,
card terminal binding, loyalty points, gift cards, and automatic payable
calculation. Sales already have `RETAIL_RECEIPT` series (ΑΠΥ) and Site tills.

## Decision
- Reuse `Invoice` with `kind = RETAIL_RECEIPT` as the fiscal sale document
- `PosSession` = open till shift on a `Site` (TILL/BRANCH)
- `PosTerminal` = card device config (`MOCK` | `VIVA` | `WORLDLINE` | …) —
  live provider APIs come later; checkout can attach `externalRef`
- Multi-tender via extended `InvoicePayment` rows (CASH/CARD/GIFT_CARD/LOYALTY/…)
- `GiftCard` + `LoyaltyAccount` / `LoyaltyLedger` are first-class balances
- Payable engine (`calcPayable`):  
  `payableDue = saleTotal − discount − giftCard − loyaltyEur`  
  then tenders must cover `payableDue` (cash may overpay → change)

### Points policy (v1 constants)
- Redeem: 100 points = 1 €
- Earn: 1 point per 1 € sale total (after successful checkout)

## Consequences
`/pos` is the cashier UI. Settings still owns ΑΠΥ series / sites.
Card authorizations are stubbed through MOCK terminal until provider adapters land.
