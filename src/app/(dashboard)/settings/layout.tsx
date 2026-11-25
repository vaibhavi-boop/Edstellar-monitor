import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { requireUser } from "@/server/auth/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Settings" className="pb-4" />
      <SettingsTabs isAdmin={user.role === "ADMIN"} />
      {children}
    </>
  );
}
