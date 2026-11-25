import { PhasePlaceholder } from "@/components/layout/phase-placeholder";
import { navItem } from "@/lib/navigation";

const item = navItem("/ssl");
export const metadata = { title: item.label };

export default function Page() {
  return <PhasePlaceholder item={item} />;
}
