"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Check, Landmark } from "lucide-react";

type Company = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  isDefault: boolean;
};

type Workspace = {
  tenantId: string;
  slug: string;
  name: string;
  role: string;
  companies: Company[];
  suggestedCompanyId: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Ιδιοκτήτης",
  ADMIN: "Διαχειριστής",
  MEMBER: "Μέλος",
  VIEWER: "Θεατής",
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [email, setEmail] = useState("maria@akropolis.gr");
  const [password, setPassword] = useState("SoftifyOS!2026");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<"credentials" | "workspace">("credentials");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  const selected = useMemo(
    () => workspaces.find((w) => w.tenantId === tenantId) ?? null,
    [workspaces, tenantId],
  );

  async function enterWorkspace(tid: string, cid: string | null) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/select-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tid,
          legalEntityId: cid || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Αποτυχία επιλογής");
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
      const data = (await res.json()) as {
        error?: string;
        needsWorkspaceSelect?: boolean;
        workspaces?: Workspace[];
        lastTenantId?: string | null;
      };
      if (!res.ok) {
        setError(data.error || "Αποτυχία σύνδεσης");
        return;
      }

      if (data.needsWorkspaceSelect && data.workspaces?.length) {
        setWorkspaces(data.workspaces);
        const first = data.workspaces[0]!;
        setTenantId(first.tenantId);
        setCompanyId(first.suggestedCompanyId ?? first.companies[0]?.id ?? "");
        setStep("workspace");
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

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-950 text-lg font-bold text-white">
            S
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
            SoftifyOS
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === "credentials"
              ? "Επιχειρησιακή πλατφόρμα ERP"
              : "Επίλεξε οργανισμό και εταιρεία"}
          </p>
        </div>

        {step === "credentials" ? (
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
        ) : (
          <div className="soft-panel space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                A · Οργανισμός (Tenant)
              </p>
              <ul className="mt-2 space-y-1.5">
                {workspaces.map((w) => {
                  const active = w.tenantId === tenantId;
                  return (
                    <li key={w.tenantId}>
                      <button
                        type="button"
                        onClick={() => {
                          setTenantId(w.tenantId);
                          setCompanyId(
                            w.suggestedCompanyId ?? w.companies[0]?.id ?? "",
                          );
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          active
                            ? "border-teal-300 bg-teal-50"
                            : "border-slate-100 bg-white hover:border-slate-200"
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            active
                              ? "bg-teal-700 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          <Building2 size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink-950">
                            {w.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {w.slug} · {ROLE_LABEL[w.role] ?? w.role} ·{" "}
                            {w.companies.length} εταιρείες
                          </span>
                        </span>
                        {active ? (
                          <Check className="h-4 w-4 text-teal-700" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {selected ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  B · Εταιρεία (Legal Entity)
                </p>
                <ul className="mt-2 space-y-1.5">
                  {selected.companies.map((c) => {
                    const active = c.id === companyId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCompanyId(c.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                            active
                              ? "border-teal-300 bg-teal-50"
                              : "border-slate-100 bg-white hover:border-slate-200"
                          }`}
                        >
                          <span
                            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                              active
                                ? "bg-ink-950 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            <Landmark size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {c.name}
                              {c.isDefault ? (
                                <span className="ml-2 text-[10px] font-medium text-teal-700">
                                  default
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {c.code}
                              {c.vatNumber ? ` · ΑΦΜ ${c.vatNumber}` : ""}
                            </span>
                          </span>
                          {active ? (
                            <Check className="h-4 w-4 text-teal-700" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={pending || !tenantId}
              onClick={() => void enterWorkspace(tenantId, companyId || null)}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {pending ? "Είσοδος…" : "Είσοδος στον χώρο εργασίας"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setStep("credentials");
                setError(null);
              }}
              className="w-full text-center text-xs font-medium text-slate-500 hover:text-ink-900"
            >
              ← Πίσω στο login
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          Tenant + Company context ·{" "}
          <Link href="/api/health" className="font-medium text-teal-700">
            health
          </Link>
        </p>
      </div>
    </div>
  );
}
