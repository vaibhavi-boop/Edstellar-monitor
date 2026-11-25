import { PhasePlaceholder } from "@/components/layout/phase-placeholder";
import { navItem } from "@/lib/navigation";

const item = navItem("/api-monitoring");
export const metadata = { title: item.label };

export default function Page() {
  return <PhasePlaceholder item={item} />;
}
