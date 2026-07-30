import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <div className="soft-panel flex flex-col items-start gap-3 p-6 sm:p-8">
        <Badge tone="teal">Coming in Phase 1</Badge>
        <p className="max-w-xl text-sm leading-relaxed text-slate-600">
          Το module θα ακολουθήσει το SoftifyOS Template v2: tenant-aware
          lists με cursor pagination, detail screens, και το ίδιο desktop /
          mobile shell.
        </p>
      </div>
    </div>
  );
}
