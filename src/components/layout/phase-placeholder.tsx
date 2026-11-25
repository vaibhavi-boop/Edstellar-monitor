import { Construction } from "lucide-react";
import type { NavItem } from "@/lib/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "./page-header";

const PHASE_SCOPE: Record<number, string> = {
  2: "sitemap discovery, crawling, availability checks and the URL inventory",
  3: "broken links, the SEO audit, redirects and issue management",
  4: "API, SSL and performance monitoring",
  5: "four-hour scheduling, background jobs, notifications and run history",
  6: "reports, CSV export, testing and deployment",
};

/** Honest placeholder for screens whose data pipeline is not built yet. */
export function PhasePlaceholder({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
          <Construction className="size-5" />
        </div>
        <div>
          <p className="font-medium">This screen arrives in build phase {item.phase}</p>
          <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
            Phase {item.phase} adds {PHASE_SCOPE[item.phase]}. Until then nothing is collected for this view, so it shows
            no data rather than sample numbers. The database tables it will read from already exist.
          </p>
        </div>
      </Card>
    </>
  );
}
