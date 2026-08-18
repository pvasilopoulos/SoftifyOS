import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export function SettingsPlaceholder({
  title,
  description,
  badge = "Restored",
  bullets,
}: {
  title: string;
  description: string;
  badge?: string;
  bullets: string[];
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <section className="soft-panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Κατάσταση module</h2>
          <Badge tone="teal">{badge}</Badge>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
