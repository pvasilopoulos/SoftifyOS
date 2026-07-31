import vm from "vm";
import type { EntityModule, PrismaClient } from "@/generated/prisma/client";
import { decryptSecret } from "./secrets";

export class ScriptFailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptFailError";
  }
}

export type ScriptContext = {
  module: EntityModule;
  eventKey: string;
  record: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  user?: { id: string; role?: string } | null;
  [key: string]: unknown;
};

export type ScriptRunResult = {
  ok: boolean;
  record: Record<string, unknown>;
  logs: string[];
  httpCalls: number;
  durationMs: number;
  error?: string;
};

type HttpOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function hostOf(urlStr: string): string {
  const u = new URL(urlStr);
  return u.hostname.toLowerCase();
}

function isHostAllowed(host: string, allow: Set<string>): boolean {
  const h = host.toLowerCase();
  if (allow.has(h)) return true;
  for (const a of allow) {
    if (a.startsWith("*.") && (h === a.slice(2) || h.endsWith("." + a.slice(2)))) {
      return true;
    }
  }
  return false;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

type ScriptApi = {
  get: (path: string) => unknown;
  set: (path: string, value: unknown) => void;
  fail: (message: string) => never;
  log: (...args: unknown[]) => void;
  secrets: { get: (key: string) => Promise<string> };
  http: {
    get: (url: string, options?: HttpOptions) => Promise<unknown>;
    post: (url: string, body?: unknown, options?: HttpOptions) => Promise<unknown>;
    put: (url: string, body?: unknown, options?: HttpOptions) => Promise<unknown>;
    patch: (url: string, body?: unknown, options?: HttpOptions) => Promise<unknown>;
    delete: (url: string, options?: HttpOptions) => Promise<unknown>;
  };
};

/**
 * Run user JS in a Node vm sandbox with allow-listed api.http / secrets.
 * Scripts must define `async function run(ctx, api) { ... }`.
 */
export async function runScriptSource(opts: {
  source: string;
  ctx: ScriptContext;
  timeoutMs: number;
  maxHttpCalls: number;
  allowedHosts: string[];
  secrets: Map<string, string>;
}): Promise<ScriptRunResult> {
  const started = Date.now();
  const logs: string[] = [];
  let httpCalls = 0;
  const record = deepClone(opts.ctx.record ?? {});
  const allow = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));

  const api: ScriptApi = {
    get(path: string) {
      if (path === "record" || path === "") return deepClone(record);
      if (path.startsWith("record.")) return getPath(record, path.slice(7));
      const bag: Record<string, unknown> = { ...opts.ctx, record };
      return getPath(bag, path);
    },
    set(path: string, value: unknown) {
      if (path.startsWith("record.")) {
        setPath(record, path.slice(7), value);
        return;
      }
      // shorthand: set("vatNumber", x) writes record.vatNumber
      setPath(record, path, value);
    },
    fail(message: string): never {
      throw new ScriptFailError(String(message || "Script failed"));
    },
    log(...args: unknown[]) {
      logs.push(
        args
          .map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" "),
      );
    },
    secrets: {
      async get(key: string) {
        const v = opts.secrets.get(String(key));
        if (v == null) throw new Error(`Secret δεν βρέθηκε: ${key}`);
        return v;
      },
    },
    http: {
      async get(url: string, options?: HttpOptions) {
        return httpRequest("GET", url, undefined, options);
      },
      async post(url: string, body?: unknown, options?: HttpOptions) {
        return httpRequest("POST", url, body, options);
      },
      async put(url: string, body?: unknown, options?: HttpOptions) {
        return httpRequest("PUT", url, body, options);
      },
      async patch(url: string, body?: unknown, options?: HttpOptions) {
        return httpRequest("PATCH", url, body, options);
      },
      async delete(url: string, options?: HttpOptions) {
        return httpRequest("DELETE", url, undefined, options);
      },
    },
  };

  async function httpRequest(
    method: string,
    url: string,
    body?: unknown,
    options?: HttpOptions,
  ) {
    httpCalls += 1;
    if (httpCalls > opts.maxHttpCalls) {
      throw new Error(`Υπέρβαση ορίου HTTP κλήσεων (${opts.maxHttpCalls})`);
    }
    let host: string;
    try {
      host = hostOf(url);
    } catch {
      throw new Error("Μη έγκυρο URL");
    }
    if (!isHostAllowed(host, allow)) {
      throw new Error(
        `Host μη επιτρεπόμενος: ${host}. Πρόσθεσέ τον στην HTTP allow-list.`,
      );
    }
    const ctrl = new AbortController();
    const t = setTimeout(
      () => ctrl.abort(),
      Math.min(options?.timeoutMs ?? 5000, 8000),
    );
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...(options?.headers ?? {}),
        },
        body:
          body === undefined || method === "GET" || method === "DELETE"
            ? undefined
            : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return {
        ok: res.ok,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: json,
      };
    } finally {
      clearTimeout(t);
    }
  }

  const sandbox: Record<string, unknown> = {
    console: {
      log: (...a: unknown[]) => api.log(...a),
      warn: (...a: unknown[]) => api.log("[warn]", ...a),
      error: (...a: unknown[]) => api.log("[error]", ...a),
    },
  };

  const wrapped = `
"use strict";
${opts.source}
;
if (typeof run !== "function") {
  throw new Error("Το script πρέπει να ορίζει async function run(ctx, api) { ... }");
}
run;
`;

  try {
    const script = new vm.Script(wrapped, { filename: "tenant-script.js" });
    const runFn = script.runInNewContext(sandbox, {
      timeout: Math.min(opts.timeoutMs, 10_000),
    }) as (ctx: ScriptContext, api: ScriptApi) => Promise<unknown>;

    const ctxForScript: ScriptContext = {
      ...opts.ctx,
      record,
    };

    const resultPromise = Promise.resolve(runFn(ctxForScript, api));
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timeout ${opts.timeoutMs}ms`)),
        opts.timeoutMs + 50,
      );
    });
    await Promise.race([resultPromise, timeoutPromise]);

    return {
      ok: true,
      record,
      logs,
      httpCalls,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Script execution failed";
    return {
      ok: false,
      record,
      logs,
      httpCalls,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

export async function loadScriptRuntimeDeps(
  db: PrismaClient,
  tenantId: string,
) {
  const [settings, allow, secrets] = await Promise.all([
    db.scriptSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    }),
    db.scriptHttpAllowlist.findMany({ where: { tenantId } }),
    db.scriptSecret.findMany({ where: { tenantId } }),
  ]);

  const secretMap = new Map<string, string>();
  for (const s of secrets) {
    try {
      secretMap.set(s.key, decryptSecret(s.valueEnc));
    } catch {
      // skip broken secrets
    }
  }

  return {
    settings,
    allowedHosts: allow.map((a) => a.host),
    secrets: secretMap,
  };
}
