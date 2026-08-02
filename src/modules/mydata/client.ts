/**
 * Live AADE myDATA ERP REST client.
 * Auth: aade-user-id + ocp-apim-subscription-key
 * Docs: https://mydatapi.aade.gr/myDATA/SendInvoices (prod)
 *       https://mydataapidev.aade.gr/SendInvoices (test)
 */

export type MyDataEnv = "simulator" | "test" | "prod";

export type MyDataCredentials = {
  userId: string;
  subscriptionKey: string;
};

export type MyDataSendResult = {
  ok: boolean;
  status: number;
  mark?: string | null;
  uid?: string | null;
  errors: Array<{ code?: string; message: string }>;
  rawXml: string;
  endpoint: string;
};

const ENDPOINTS: Record<Exclude<MyDataEnv, "simulator">, string> = {
  test: "https://mydataapidev.aade.gr/SendInvoices",
  prod: "https://mydatapi.aade.gr/myDATA/SendInvoices",
};

const CANCEL_ENDPOINTS: Record<Exclude<MyDataEnv, "simulator">, string> = {
  test: "https://mydataapidev.aade.gr/CancelInvoice",
  prod: "https://mydatapi.aade.gr/myDATA/CancelInvoice",
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function myDataEndpoint(env: Exclude<MyDataEnv, "simulator">) {
  return ENDPOINTS[env];
}

export function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() ?? null;
}

export function parseSendInvoicesResponse(xml: string): {
  mark: string | null;
  uid: string | null;
  errors: Array<{ code?: string; message: string }>;
  accepted: boolean;
} {
  const mark =
    extractXmlTag(xml, "invoiceMark") ??
    extractXmlTag(xml, "mark") ??
    null;
  const uid = extractXmlTag(xml, "invoiceUid") ?? extractXmlTag(xml, "uid") ?? null;
  const statusCode =
    extractXmlTag(xml, "statusCode") ?? extractXmlTag(xml, "StatusCode");
  const errors: Array<{ code?: string; message: string }> = [];

  const errorBlocks = xml.matchAll(
    /<error>([\s\S]*?)<\/error>/gi,
  );
  for (const block of errorBlocks) {
    const inner = block[1] ?? "";
    const code = extractXmlTag(inner, "code") ?? extractXmlTag(inner, "errorCode");
    const message =
      extractXmlTag(inner, "message") ??
      extractXmlTag(inner, "errorMessage") ??
      inner.trim();
    if (message) errors.push({ code: code ?? undefined, message });
  }

  const accepted =
    Boolean(mark) &&
    errors.length === 0 &&
    (!statusCode || /success|ok|accepted/i.test(statusCode));

  if (!accepted && errors.length === 0 && statusCode) {
    errors.push({ message: `AADE status: ${statusCode}` });
  }
  if (!accepted && errors.length === 0 && !mark) {
    errors.push({ message: "Δεν επιστράφηκε MARK από ΑΑΔΕ" });
  }

  return { mark, uid, errors, accepted };
}

export async function sendInvoicesXml(
  env: Exclude<MyDataEnv, "simulator">,
  credentials: MyDataCredentials,
  invoicesDocXml: string,
  opts?: { timeoutMs?: number },
): Promise<MyDataSendResult> {
  const endpoint = myDataEndpoint(env);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? 45_000,
  );

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml",
        "aade-user-id": credentials.userId,
        "ocp-apim-subscription-key": credentials.subscriptionKey,
      },
      body: invoicesDocXml,
      signal: controller.signal,
    });
    const rawXml = await res.text();
    const parsed = parseSendInvoicesResponse(rawXml);
    return {
      ok: res.ok && parsed.accepted,
      status: res.status,
      mark: parsed.mark,
      uid: parsed.uid,
      errors: parsed.errors.length
        ? parsed.errors
        : res.ok
          ? []
          : [{ message: `HTTP ${res.status}` }],
      rawXml,
      endpoint,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Σφάλμα σύνδεσης ΑΑΔΕ";
    return {
      ok: false,
      status: 0,
      mark: null,
      uid: null,
      errors: [{ message }],
      rawXml: "",
      endpoint,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Cancel a previously accepted invoice by MARK (AADE CancelInvoice). */
export async function cancelInvoiceMark(
  env: Exclude<MyDataEnv, "simulator">,
  credentials: MyDataCredentials,
  mark: string,
  opts?: { timeoutMs?: number },
): Promise<MyDataSendResult> {
  const endpoint = CANCEL_ENDPOINTS[env];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? 45_000,
  );
  const body = `<?xml version="1.0" encoding="utf-8"?>\n<cancelInvoice mark="${escapeXml(mark)}"/>`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml",
        "aade-user-id": credentials.userId,
        "ocp-apim-subscription-key": credentials.subscriptionKey,
      },
      body,
      signal: controller.signal,
    });
    const rawXml = await res.text();
    const parsed = parseSendInvoicesResponse(rawXml);
    const cancelled =
      res.ok &&
      (parsed.accepted ||
        /success|ok|cancelled|canceled/i.test(rawXml) ||
        Boolean(extractXmlTag(rawXml, "cancellationMark")));
    return {
      ok: cancelled,
      status: res.status,
      mark: parsed.mark ?? mark,
      uid: parsed.uid,
      errors: cancelled
        ? []
        : parsed.errors.length
          ? parsed.errors
          : [{ message: `HTTP ${res.status}` }],
      rawXml,
      endpoint,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Σφάλμα σύνδεσης ΑΑΔΕ";
    return {
      ok: false,
      status: 0,
      mark: null,
      uid: null,
      errors: [{ message }],
      rawXml: "",
      endpoint,
    };
  } finally {
    clearTimeout(timer);
  }
}

export { escapeXml };
