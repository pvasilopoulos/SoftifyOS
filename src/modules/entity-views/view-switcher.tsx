"use client";

import { cn } from "@/shared/lib/cn";

export type ViewOption = {
  id: string;
  code: string;
  name: string;
  isDefault?: boolean;
};

export function ViewSwitcher({
  label = "Προβολή",
  views,
  value,
  onChange,
}: {
  label?: string;
  views: ViewOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (views.length <= 1) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="whitespace-nowrap font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink-900"
      >
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.isDefault ? " · default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ViewTabs({
  views,
  value,
  onChange,
}: {
  views: ViewOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (views.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            value === v.id
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-teal-200",
          )}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}
