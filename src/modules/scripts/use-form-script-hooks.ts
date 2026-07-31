"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EntityModule } from "@/generated/prisma/client";

export type UiScriptResult = {
  ok: boolean;
  record?: Record<string, unknown>;
  error?: string;
  script?: string;
};

/**
 * Client helper: run published UI scripts via sandbox API.
 * Debounced for onFieldChange.
 */
export function useFormScriptHooks(opts: {
  module: EntityModule;
  enabled?: boolean;
  mode?: "create" | "edit" | "view";
  getRecord: () => Record<string, unknown>;
  applyRecord: (record: Record<string, unknown>) => void;
  onFail?: (message: string, script?: string) => void;
}) {
  const enabled = opts.enabled !== false;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async (
      eventKey: string,
      extra?: {
        field?: string;
        value?: unknown;
        previous?: Record<string, unknown> | null;
        recordOverride?: Record<string, unknown>;
      },
    ): Promise<UiScriptResult> => {
      const o = optsRef.current;
      if (!enabled) return { ok: true, record: o.getRecord() };
      try {
        const res = await fetch("/api/scripts/ui-event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            module: o.module,
            eventKey,
            record: extra?.recordOverride ?? o.getRecord(),
            mode: o.mode,
            field: extra?.field,
            value: extra?.value,
            previous: extra?.previous ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || "Script failed" };
        }
        if (data.ok === false) {
          o.onFail?.(data.error, data.script);
          if (data.record) o.applyRecord(data.record);
          return {
            ok: false,
            error: data.error,
            script: data.script,
            record: data.record,
          };
        }
        if (data.record) o.applyRecord(data.record);
        return { ok: true, record: data.record };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Script failed",
        };
      }
    },
    [enabled],
  );

  const onLoad = useCallback(() => {
    void run("form.onLoad");
  }, [run]);

  const onFieldChange = useCallback(
    (field: string, value: unknown, recordOverride?: Record<string, unknown>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void run("form.onFieldChange", { field, value, recordOverride });
      }, 320);
    },
    [run],
  );

  const beforeSubmit = useCallback(async () => {
    return run("form.beforeSubmit");
  }, [run]);

  return { run, onLoad, onFieldChange, beforeSubmit };
}
