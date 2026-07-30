"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SoftifyOS]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
        <AlertTriangle size={22} />
      </span>
      <h1 className="text-xl font-semibold text-ink-950">Κάτι πήγε στραβά</h1>
      <p className="mt-2 text-sm text-slate-500">
        Η οθόνη δεν φορτώθηκε σωστά. Μπορείτε να δοκιμάσετε ξανά χωρίς να χάσετε
        τη συνεδρία σας.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[11px] text-slate-400">
          ref: {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
        >
          <RefreshCw size={15} />
          Δοκιμή ξανά
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-slate-50"
        >
          Πίνακας ελέγχου
        </Link>
      </div>
    </div>
  );
}
