import Link from "next/link";

export const metadata = { title: "Σύνδεση" };

export default function LoginPage() {
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

        <form
          action="/"
          className="soft-panel space-y-4 p-5 sm:p-6"
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-900">
              Email
            </label>
            <input
              type="email"
              defaultValue="maria@akropolis.gr"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-900">
              Κωδικός
            </label>
            <input
              type="password"
              defaultValue="••••••••"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </div>
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-medium text-white hover:bg-teal-700"
          >
            Σύνδεση
          </button>
          <p className="text-center text-xs text-slate-500">
            Demo · Template v2 Desktop + Mobile
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Ή{" "}
          <Link href="/" className="font-medium text-teal-700 hover:text-teal-800">
            είσοδος στο dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
