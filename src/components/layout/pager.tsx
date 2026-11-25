import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

/** Previous/next pagination for server-rendered lists. `href(page)` builds each link. */
export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex flex-col gap-2 border-t px-4 py-3 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between" aria-label="Pagination">
      <span>
        {formatNumber(Math.min((page - 1) * pageSize + 1, total))}–{formatNumber(Math.min(page * pageSize, total))} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={href(page - 1)}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            <ChevronLeft /> Previous
          </Button>
        )}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={href(page + 1)}>
              Next <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            Next <ChevronRight />
          </Button>
        )}
      </div>
    </nav>
  );
}
