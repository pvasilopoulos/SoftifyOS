"use client";

import { useRouter } from "next/navigation";
import { quickActions } from "@/platform/navigation";

export function QuickActionsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/40"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
        <h2 className="mb-3 text-base font-semibold text-ink-950">
          Γρήγορες ενέργειες
        </h2>
        <ul className="space-y-1.5">
          {quickActions.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className="flex w-full items-center rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm font-medium text-ink-900 hover:bg-teal-50"
                onClick={() => {
                  onClose();
                  router.push(action.href);
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
