"use client";
import type { WebsiteConfiguration } from "@/generated/prisma/client";
import { CATEGORY_LABELS, issueTypesByCategory, SEVERITY_LABELS } from "@/lib/issue-catalog";
import { frequencyLabel } from "@/lib/utils";
import { updateWebsiteConfiguration } from "@/server/websites/actions";
import { CRAWL_FREQUENCIES } from "@/server/websites/schema";
import { Checkbox, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CardContent, CardFooter } from "@/components/ui/card";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-b px-5 py-5 last:border-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function WebsiteConfigForm({
  websiteId,
  domain,
  config,
  canEdit,
}: {
  websiteId: string;
  domain: string;
  config: WebsiteConfiguration;
  canEdit: boolean;
}) {
  const { state, onSubmit, pending } = useFormAction(updateWebsiteConfiguration.bind(null, websiteId));
  const e = state.fieldErrors ?? {};
  const ignored = new Set(config.ignoredIssueTypes);

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!canEdit} className="contents">
        {state.message && (
          <div className="px-5 pt-4">
            <FormMessage state={state} />
          </div>
        )}
        {Object.keys(e).length > 0 && !state.message && (
          <div className="px-5 pt-4">
            <FormMessage state={{ ok: false, message: "Some settings need attention. Check the highlighted fields." }} />
          </div>
        )}

        <Section title="Schedule" description="How often the full monitoring cycle runs. The scheduler is connected in build phase 5.">
          <Field id="crawlFrequencyMinutes" label="Check frequency" errors={e.crawlFrequencyMinutes}>
            <NativeSelect {...describe("crawlFrequencyMinutes", state)} defaultValue={config.crawlFrequencyMinutes}>
              {CRAWL_FREQUENCIES.map((m) => (
                <option key={m} value={m}>
                  {frequencyLabel(m)}
                  {m === 240 ? " (recommended)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </Section>

        <Section title="Crawl scope" description={`Only ${domain}${config.includeWwwVariant ? ` and www.${domain}` : ""} are crawled, plus any host aliases mapped onto it.`}>
          <Field id="crawlDepth" label="Crawl depth" hint="Link hops from the home page and sitemap URLs (1–50)" errors={e.crawlDepth}>
            <Input {...describe("crawlDepth", state)} type="number" min={1} max={50} defaultValue={config.crawlDepth} />
          </Field>
          <Field id="maxUrls" label="Maximum URLs" hint="Crawling stops at this many URLs (up to 100,000)" errors={e.maxUrls}>
            <Input {...describe("maxUrls", state)} type="number" min={1} max={100000} defaultValue={config.maxUrls} />
          </Field>
          <Field
            id="includePatterns"
            label="Include only these paths"
            hint="One path pattern per line, e.g. /courses/**. Leave empty to include everything."
            errors={e.includePatterns}
          >
            <Textarea {...describe("includePatterns", state)} defaultValue={config.includePatterns.join("\n")} spellCheck={false} />
          </Field>
          <Field id="excludePatterns" label="Exclude these paths" hint="One per line, e.g. /search* or /cart/**" errors={e.excludePatterns}>
            <Textarea {...describe("excludePatterns", state)} defaultValue={config.excludePatterns.join("\n")} spellCheck={false} />
          </Field>
          <Field
            id="keptQueryParams"
            label="Query parameters that make a page distinct"
            hint="One per line. Every other parameter (utm_source and so on) is removed before URLs are compared."
            errors={e.keptQueryParams}
          >
            <Textarea {...describe("keptQueryParams", state)} defaultValue={config.keptQueryParams.join("\n")} className="min-h-20" spellCheck={false} />
          </Field>
          <label className="flex items-start gap-2.5 self-start pt-7 text-sm">
            <Checkbox name="includeWwwVariant" defaultChecked={config.includeWwwVariant} className="mt-0.5" />
            <span>
              Treat www.{domain} as the same site
              <span className="block text-[13px] text-muted-foreground">Recommended. Other subdomains stay out of scope.</span>
            </span>
          </label>
          <Field
            id="hostAliases"
            label="Host aliases"
            hint={`One host per line. Links and sitemap URLs on these hosts are checked as the same path on ${domain}. Use the production domain when monitoring a staging deployment.`}
            errors={e.hostAliases}
          >
            <Textarea {...describe("hostAliases", state)} defaultValue={config.hostAliases.join("\n")} className="min-h-20" spellCheck={false} placeholder="www.example.com" />
          </Field>
          <label className="flex items-start gap-2.5 self-start pt-7 text-sm">
            <Checkbox name="respectRobotsTxt" defaultChecked={config.respectRobotsTxt} className="mt-0.5" />
            <span>
              Respect robots.txt
              <span className="block text-[13px] text-muted-foreground">
                Recommended for live sites. Turn off for a staging deployment whose robots.txt blocks every crawler.
              </span>
            </span>
          </label>
        </Section>

        <Section title="Requests" description="Keep these gentle: the crawler should never slow the site down for visitors.">
          <Field id="concurrentRequests" label="Concurrent requests" hint="Parallel requests to the site (1–10)" errors={e.concurrentRequests}>
            <Input {...describe("concurrentRequests", state)} type="number" min={1} max={10} defaultValue={config.concurrentRequests} />
          </Field>
          <Field id="requestTimeoutSeconds" label="Request timeout (seconds)" hint="1–60 seconds" errors={e.requestTimeoutSeconds}>
            <Input {...describe("requestTimeoutSeconds", state)} type="number" min={1} max={60} defaultValue={config.requestTimeoutMs / 1000} />
          </Field>
          <Field id="retryAttempts" label="Retry attempts" hint="Retries with exponential backoff (0–5)" errors={e.retryAttempts}>
            <Input {...describe("retryAttempts", state)} type="number" min={0} max={5} defaultValue={config.retryAttempts} />
          </Field>
          <Field id="userAgent" label="User agent" hint="Lets the site owner recognise and allow-list the monitor" errors={e.userAgent}>
            <Input {...describe("userAgent", state)} defaultValue={config.userAgent} className="font-mono text-[13px]" spellCheck={false} />
          </Field>
        </Section>

        <Section title="SSL and performance" description="Certificate warnings and optional browser-based scores.">
          <Field
            id="sslWarningDays"
            label="Warn before SSL expiry (days)"
            hint="Comma-separated thresholds, e.g. 30, 15, 7, 3"
            errors={e.sslWarningDays}
          >
            <Input {...describe("sslWarningDays", state)} defaultValue={config.sslWarningDays.join(", ")} />
          </Field>
          <label className="flex items-start gap-2.5 self-start pt-7 text-sm">
            <Checkbox name="pageSpeedEnabled" defaultChecked={config.pageSpeedEnabled} className="mt-0.5" />
            <span>
              Collect PageSpeed Insights scores
              <span className="block text-[13px] text-muted-foreground">Lighthouse scores for up to 5 key pages per run. Needs PAGESPEED_API_KEY on the server that runs the worker.</span>
            </span>
          </label>
        </Section>

        <div className="border-b px-5 py-5">
          <h3 className="text-sm font-semibold">Ignored issue types</h3>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
            Ticked types are still checked but never raised as issues for this website. Use this for findings you have decided to accept.
          </p>
          {e.ignoredIssueTypes && <p className="mt-2 text-[13px] text-destructive">{e.ignoredIssueTypes.join(" ")}</p>}
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            {issueTypesByCategory().map(([category, types]) => (
              <fieldset key={category}>
                <legend className="mb-2 text-[13px] font-medium">{CATEGORY_LABELS[category]}</legend>
                <ul className="space-y-1.5">
                  {types.map((t) => (
                    <li key={t.key}>
                      <label className="flex items-center gap-2 text-[13px]">
                        <Checkbox name="ignoredIssueTypes" value={t.key} defaultChecked={ignored.has(t.key)} />
                        <span className="flex-1">{t.title}</span>
                        <span className="text-xs text-muted-foreground">{SEVERITY_LABELS[t.severity]}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        </div>

        {canEdit && (
          <CardFooter className="sticky bottom-0 z-10 rounded-b-lg bg-surface shadow-[0_-1px_0_var(--border)]">
            <SubmitButton pending={pending} pendingText="Saving…">Save monitoring settings</SubmitButton>
            <span className="text-[13px] text-muted-foreground">Changes apply from the next monitoring run.</span>
          </CardFooter>
        )}
      </fieldset>
    </form>
  );
}
