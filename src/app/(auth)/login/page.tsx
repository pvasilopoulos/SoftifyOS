import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata = { title: "Σύνδεση" };

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center bg-[#F1F4F7] text-sm text-slate-500">
          Φόρτωση...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
