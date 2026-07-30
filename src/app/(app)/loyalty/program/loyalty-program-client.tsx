"use client";

import {
  LoyaltyProgramEditor,
  type LoyaltyProgramForm,
} from "../loyalty-program-editor";

/** @deprecated Prefer LoyaltyProgramEditor via /loyalty?tab=program */
export function LoyaltyProgramClient({
  initial,
}: {
  initial: LoyaltyProgramForm;
}) {
  return <LoyaltyProgramEditor initial={initial} />;
}
