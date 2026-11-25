import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { WebsiteSwitcher } from "@/components/layout/website-switcher";
import { ROLE_LABELS } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { getActiveWebsite, listWebsites } from "@/server/websites/queries";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [websites, active] = await Promise.all([listWebsites(), getActiveWebsite()]);

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto bg-rail lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-5">
          <Brand />
        </div>
        <SidebarNav />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-surface/90 px-4 backdrop-blur sm:px-6">
        <MobileNav />
        <WebsiteSwitcher
          websites={websites.map((w) => ({ id: w.id, name: w.name, domain: w.domain, status: w.status }))}
          activeId={active?.id ?? null}
        />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} roleLabel={ROLE_LABELS[user.role]} isAdmin={user.role === "ADMIN"} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
