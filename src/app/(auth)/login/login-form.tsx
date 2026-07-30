"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [email, setEmail] = useState("maria@akropolis.gr");
  const [password, setPassword] = useState("SoftifyOS!2026");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Αποτυχία σύνδεσης");
        return;
      }
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch {
      setError("Πρόβλημα δικτύου. Δοκιμάστε ξανά.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#F1F4F7] px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(13,148,136,0.12), transparent 40%), radial-gradient(circle at 80% 0%, rgba(11,18,32,0.08), transparent 35%), linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230b1220' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-950 text-lg font-bold text-white">
            S
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
            SoftifyOS
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Επιχειρησιακή πλατφόρμα ERP
          </p>
        </div>

        <form onSubmit={onSubmit} className="soft-panel space-y-4 p-5 sm:p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-900">
              Email
            </label>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-900">
              Κωδικός
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </div>
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {pending ? "Σύνδεση..." : "Σύνδεση"}
          </button>
          <p className="text-center text-xs text-slate-500">
            Demo · maria@akropolis.gr / SoftifyOS!2026
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Phase 0 platform ·{" "}
          <Link href="/api/health" className="font-medium text-teal-700">
            health
          </Link>
        </p>
      </div>
    </div>
  );
}
