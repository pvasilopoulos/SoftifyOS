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
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

/**
 * Dedicated POS scan field:
 * - USB/Bluetooth scanners type into the input and send Enter
 * - Camera button opens live barcode/QR reader (html5-qrcode)
 */
export function PosBarcodeScan({
  onScan,
  className,
}: {
  onScan: (code: string) => { ok: true } | { ok: false; error: string };
  className?: string;
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

  const applyCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      // Debounce duplicate camera frames / double Enter
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < 900
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };
      const result = onScan(code);
      setValue("");
      if (result.ok) {
        setError(null);
        setHint(`Προστέθηκε · ${code}`);
        window.setTimeout(() => setHint(null), 1600);
      } else {
        setHint(null);
        setError(result.error);
      }
      inputRef.current?.focus();
    },
    [onScan],
  );

  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;

    (async () => {
      setCameraError(null);
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const Html5Qrcode = mod.Html5Qrcode as unknown as new (
          id: string,
        ) => Html5QrcodeLike;
        const scanner = new Html5Qrcode(`pos-scan-${readerDomId}`);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 240, height: 140 },
            aspectRatio: 1.777,
          },
          (decoded) => {
            applyCode(decoded);
            setCameraOpen(false);
          },
          () => {
            /* ignore frame miss */
          },
        );
      } catch (e) {
        setCameraError(
          e instanceof Error
            ? e.message
            : "Αδυναμία πρόσβασης στην κάμερα",
        );
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        void scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => undefined);
      }
    };
  }, [cameraOpen, readerDomId, applyCode]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanBarcode
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCode(value);
              }
            }}
            autoComplete="off"
            autoFocus
            inputMode="none"
            placeholder="Scan barcode / SKU…"
            aria-label="Σάρωση barcode"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={cameraOpen ? "primary" : "secondary"}
          onClick={() => setCameraOpen((v) => !v)}
          title="Κάμερα"
        >
          <Camera size={16} />
          <span className="hidden sm:inline">Κάμερα</span>
        </Button>
      </div>
      {hint ? (
        <p className="text-xs text-emerald-700">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}

      {cameraOpen ? (
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-ink-950">
          <button
            type="button"
            onClick={() => setCameraOpen(false)}
            className="absolute right-2 top-2 z-10 rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"
            aria-label="Κλείσιμο κάμερας"
          >
            <X size={16} />
          </button>
          <div id={`pos-scan-${readerDomId}`} className="min-h-[220px] w-full" />
          {cameraError ? (
            <p className="px-3 py-2 text-xs text-rose-200">{cameraError}</p>
          ) : (
            <p className="px-3 py-2 text-xs text-slate-300">
              Στόχευσε barcode ή QR · αυτόματη προσθήκη στο καλάθι
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
