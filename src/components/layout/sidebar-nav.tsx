"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-xs font-medium text-rail-muted">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-8 items-center gap-2.5 rounded-md px-3 text-[13.5px] transition-colors",
                      active
                        ? "bg-rail-active font-medium text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-rail-accent"
                        : "text-rail-foreground hover:bg-rail-active/60 hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-rail-accent" : "text-rail-muted")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.phase > 1 && (
                      <span className="text-[11px] text-rail-muted" title={`Arrives in build phase ${item.phase}`}>
                        P{item.phase}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
