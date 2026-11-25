import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden bg-rail p-12 text-rail-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white">Edstellar Monitor</span>
        </div>
        <div className="max-w-md">
          <p className="font-[family-name:var(--font-heading)] text-[30px] font-semibold leading-tight tracking-[-0.02em] text-white">
            Every page of edstellar.com, <span className="text-accent">checked every four hours.</span>
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-rail-muted">
            Availability, broken links, SEO, redirects, APIs, SSL and performance, with a record of when each problem
            appeared and when it was fixed.
          </p>
        </div>
        <svg viewBox="0 0 480 80" className="w-full max-w-lg opacity-70" aria-hidden="true">
          <path
            d="M0 52h70l14-30 18 46 14-34 10 18h90l12-22 16 38 12-26h70l14-20 16 32 12-14h92"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the account your administrator created for you.</p>
          {reason === "ended" && (
            <p role="status" className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              Your session ended because your account or password changed. Sign in again.
            </p>
          )}
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
