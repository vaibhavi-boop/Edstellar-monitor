"use client";
import { useState } from "react";
import Link from "next/link";
import type { ApiAuthType, HttpMethod } from "@/generated/prisma/enums";
import { createApiEndpoint, updateApiEndpoint } from "@/server/api-endpoints/actions";
import { API_FREQUENCIES } from "@/server/api-endpoints/schema";
import { frequencyLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export interface EndpointFormValues {
  id: string;
  name: string;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  authType: ApiAuthType;
  hasCredentials: boolean;
  requestBody: string | null;
  expectedStatus: number;
  expectedFields: string[];
  timeoutMs: number;
  frequencyMinutes: number;
  isActive: boolean;
}

const AUTH_LABELS: Record<ApiAuthType, string> = {
  NONE: "None",
  BEARER: "Bearer token",
  BASIC: "Basic (username and password)",
  API_KEY_HEADER: "API key in a header",
};

export function EndpointForm({ websiteId, endpoint, canEdit }: { websiteId: string; endpoint?: EndpointFormValues; canEdit: boolean }) {
  const action = endpoint ? updateApiEndpoint.bind(null, endpoint.id) : createApiEndpoint.bind(null, websiteId);
  const { state, onSubmit, pending } = useFormAction(action);
  const [authType, setAuthType] = useState<ApiAuthType>(endpoint?.authType ?? "NONE");
  const [method, setMethod] = useState<HttpMethod>(endpoint?.method ?? "GET");
  const e = state.fieldErrors ?? {};
  const keep = endpoint?.hasCredentials && endpoint.authType === authType;
  const secretHint = keep ? "Stored encrypted. Leave blank to keep the current value." : "Stored encrypted with ENCRYPTION_KEY and never shown again.";

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!canEdit} className="contents">
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          <Field id="name" label="Name" errors={e.name}>
            <Input {...describe("name", state)} defaultValue={endpoint?.name} placeholder="Course search API" required />
          </Field>
          <Field id="frequencyMinutes" label="Check frequency" hint="Used by the scheduler (phase 5). Every monitoring run checks active endpoints." errors={e.frequencyMinutes}>
            <NativeSelect {...describe("frequencyMinutes", state)} defaultValue={endpoint?.frequencyMinutes ?? 240}>
              {API_FREQUENCIES.map((m) => <option key={m} value={m}>{frequencyLabel(m)}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <Field id="method" label="Method" errors={e.method}>
              <NativeSelect {...describe("method", state)} value={method} onChange={(ev) => setMethod(ev.target.value as HttpMethod)}>
                {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => <option key={m}>{m}</option>)}
              </NativeSelect>
            </Field>
            <Field id="url" label="URL" hint="Any public https URL. Private and internal addresses are refused." errors={e.url}>
              <Input {...describe("url", state)} type="url" defaultValue={endpoint?.url} placeholder="https://api.example.com/v1/courses?limit=1" className="font-mono text-[13px]" spellCheck={false} required />
            </Field>
          </div>
          <Field id="headers" label="Headers" hint="One per line, Name: value. Not encrypted, so no secrets here." errors={e.headers} className="sm:col-span-2">
            <Textarea {...describe("headers", state)} defaultValue={Object.entries(endpoint?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")} placeholder="Accept-Language: en" className="min-h-20 font-mono text-[13px]" spellCheck={false} />
          </Field>
          {method !== "GET" && (
            <Field id="requestBody" label="Request body" hint="Sent as application/json unless a Content-Type header is set." errors={e.requestBody} className="sm:col-span-2">
              <Textarea {...describe("requestBody", state)} defaultValue={endpoint?.requestBody ?? ""} placeholder='{"query": "leadership"}' className="min-h-24 font-mono text-[13px]" spellCheck={false} />
            </Field>
          )}

          <Field id="authType" label="Authentication" errors={e.authType}>
            <NativeSelect {...describe("authType", state)} value={authType} onChange={(ev) => setAuthType(ev.target.value as ApiAuthType)}>
              {(Object.keys(AUTH_LABELS) as ApiAuthType[]).map((t) => <option key={t} value={t}>{AUTH_LABELS[t]}</option>)}
            </NativeSelect>
          </Field>
          <div className="hidden sm:block" />
          {authType === "BEARER" && (
            <Field id="authToken" label="Token" hint={secretHint} errors={e.authToken} className="sm:col-span-2">
              <Input {...describe("authToken", state)} type="password" autoComplete="off" placeholder={keep ? "••••••••" : ""} />
            </Field>
          )}
          {authType === "BASIC" && (
            <>
              <Field id="authUsername" label="Username" hint={secretHint} errors={e.authUsername}>
                <Input {...describe("authUsername", state)} autoComplete="off" placeholder={keep ? "••••••••" : ""} />
              </Field>
              <Field id="authPassword" label="Password" errors={e.authPassword}>
                <Input {...describe("authPassword", state)} type="password" autoComplete="new-password" placeholder={keep ? "••••••••" : ""} />
              </Field>
            </>
          )}
          {authType === "API_KEY_HEADER" && (
            <>
              <Field id="authHeader" label="Header name" hint={keep ? "To change the header name, enter the key again." : undefined} errors={e.authHeader}>
                <Input {...describe("authHeader", state)} placeholder="X-Api-Key" autoComplete="off" />
              </Field>
              <Field id="authValue" label="Key" hint={secretHint} errors={e.authValue}>
                <Input {...describe("authValue", state)} type="password" autoComplete="off" placeholder={keep ? "••••••••" : ""} />
              </Field>
            </>
          )}

          <Field id="expectedStatus" label="Expected status" errors={e.expectedStatus}>
            <Input {...describe("expectedStatus", state)} type="number" min={100} max={599} defaultValue={endpoint?.expectedStatus ?? 200} />
          </Field>
          <Field id="timeoutSeconds" label="Timeout (seconds)" errors={e.timeoutSeconds}>
            <Input {...describe("timeoutSeconds", state)} type="number" min={1} max={60} defaultValue={(endpoint?.timeoutMs ?? 10000) / 1000} />
          </Field>
          <Field id="expectedFields" label="Expected JSON fields" hint="One dotted path per line, e.g. data.items.0.id. Leave empty to check the status only." errors={e.expectedFields} className="sm:col-span-2">
            <Textarea {...describe("expectedFields", state)} defaultValue={endpoint?.expectedFields.join("\n")} className="min-h-20 font-mono text-[13px]" spellCheck={false} />
          </Field>
          <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <Checkbox name="isActive" defaultChecked={endpoint?.isActive ?? true} className="mt-0.5" />
            <span>
              Active
              <span className="block text-[13px] text-muted-foreground">Inactive endpoints keep their history but are not checked.</span>
            </span>
          </label>
        </CardContent>
        {canEdit && (
          <CardFooter>
            <SubmitButton pending={pending} pendingText="Checking URL…">{endpoint ? "Save endpoint" : "Add endpoint"}</SubmitButton>
            {!endpoint && (
              <Button variant="ghost" asChild>
                <Link href="/api-monitoring">Cancel</Link>
              </Button>
            )}
          </CardFooter>
        )}
      </fieldset>
    </form>
  );
}
