"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/settings", label: "Account" },
    ...(isAdmin
      ? [
          { href: "/settings/users", label: "Team access" },
          { href: "/settings/activity", label: "Activity log" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Settings" className="mb-6 flex gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
