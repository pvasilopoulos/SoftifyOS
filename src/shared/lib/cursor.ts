import { z } from "zod";

export type CursorPayload = {
  createdAt: string; // ISO
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed?.createdAt || !parsed?.id) return null;
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
});

/**
 * Keyset filter for (createdAt DESC, id DESC) ordering.
 * Avoids OFFSET which degrades at 1M+ rows.
 */
export function cursorWhere(cursor: CursorPayload | null | undefined) {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      {
        AND: [{ createdAt: { equals: createdAt } }, { id: { lt: cursor.id } }],
      },
    ],
  };
}
