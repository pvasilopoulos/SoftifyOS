"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Camera, ScanBarcode, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type Html5QrcodeLike = {
  start: (
    cameraIdOrConfig: unknown,
    config: unknown,
    onSuccess: (decoded: string) => void,
    onError?: (err: string) => void,
  ) => Promise<unknown>;
  stop: () => Promise<unknown>;
  clear: () => void;
};

type ScanResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Modern barcode field for WMS / POS:
 * USB scanners → Enter · Camera via html5-qrcode
 */
export function BarcodeScanField({
  onScan,
  className,
  placeholder = "Σάρωση barcode / SKU / serial…",
  autoFocus = true,
  size = "lg",
}: {
  onScan: (code: string) => ScanResult | Promise<ScanResult>;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5QrcodeLike | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const readerDomId = useId().replace(/:/g, "");
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);

  const applyCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < 900
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };
      const result = await onScan(code);
      setValue("");
      if (result.ok) {
        setError(null);
        setHint(result.message ?? `OK · ${code}`);
        setPulse(true);
        window.setTimeout(() => setPulse(false), 500);
        window.setTimeout(() => setHint(null), 1800);
      } else {
        setHint(null);
        setError(result.error);
      }
      inputRef.current?.focus();
    },
    [onScan],
  );

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;

    (async () => {
      try {
        setCameraError(null);
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const Html5Qrcode = mod.Html5Qrcode as unknown as new (
          id: string,
        ) => Html5QrcodeLike;
        const scanner = new Html5Qrcode(readerDomId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 140 } },
          (decoded) => {
            void applyCode(decoded);
          },
          () => undefined,
        );
      } catch {
        if (!cancelled) {
          setCameraError("Η κάμερα δεν είναι διαθέσιμη σε αυτό το περιβάλλον");
        }
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        void s.stop().then(() => s.clear()).catch(() => undefined);
      }
    };
  }, [cameraOpen, readerDomId, applyCode]);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-2xl border bg-white/80 shadow-sm backdrop-blur transition",
          pulse
            ? "border-teal-400 ring-2 ring-teal-300/50"
            : "border-slate-200/80",
          size === "lg" ? "p-2.5" : "p-1.5",
        )}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 text-white shadow-inner">
          <ScanBarcode className="h-5 w-5" />
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void applyCode(value);
            }
          }}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent font-medium text-ink-950 outline-none placeholder:text-slate-400",
            size === "lg" ? "h-11 text-base" : "h-9 text-sm",
          )}
          autoComplete="off"
          inputMode="none"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => setCameraOpen((v) => !v)}
        >
          {cameraOpen ? <X className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        </Button>
      </div>
      {hint ? (
        <p className="animate-in fade-in text-xs font-medium text-teal-700">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : null}
      {cameraOpen ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
          <div id={readerDomId} className="min-h-[180px] w-full" />
          {cameraError ? (
            <p className="px-3 py-2 text-xs text-rose-200">{cameraError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
