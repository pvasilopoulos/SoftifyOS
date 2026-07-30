import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-teal-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink-950">
        Η σελίδα δεν βρέθηκε
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Ο σύνδεσμος μπορεί να είναι παλιός ή να μην έχετε πρόσβαση σε αυτόν τον
        πόρο του tenant.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
      >
        Επιστροφή στον πίνακα
      </Link>
    </div>
  );
}
