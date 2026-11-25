"use client";
import { useState, useTransition } from "react";
import { Hash, Loader2, Mail, Send, Trash2 } from "lucide-react";
import type { NotificationChannel, NotificationEvent } from "@/generated/prisma/enums";
import type { ActionState } from "@/lib/action-state";
import { addNotification, removeNotification, sendTestNotification, toggleNotification } from "@/server/notify/actions";
import { EVENT_LABELS, EVENT_ORDER } from "@/server/notify/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Checkbox, Input, NativeSelect } from "@/components/ui/input";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export interface NotificationPref {
  id: string;
  channel: NotificationChannel;
  target: string | null;
  events: NotificationEvent[];
  isEnabled: boolean;
}

const DEFAULT_EVENTS: NotificationEvent[] = ["WEBSITE_DOWN", "CRITICAL_ISSUE", "API_FAILURE", "SSL_EXPIRY", "CRITICAL_RESOLVED"];

function PrefRow({ pref, canEdit }: { pref: NotificationPref; canEdit: boolean }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState>) => start(async () => setState(await fn()));
  const Icon = pref.channel === "EMAIL" ? Mail : Hash;
  return (
    <li className="flex flex-col gap-2 border-b px-5 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-medium">{pref.channel === "EMAIL" ? pref.target : `Slack webhook ${pref.target ?? ""}`}</span>
        {!pref.isEnabled && <Badge tone="warning">Paused</Badge>}
        <span className="flex-1" />
        {canEdit && (
          <div className="flex items-center gap-1">
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => sendTestNotification(pref.id))}><Send /> Send test</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => toggleNotification(pref.id, !pref.isEnabled))}>{pref.isEnabled ? "Pause" : "Enable"}</Button>
            <Button variant="ghost" size="sm" disabled={pending} className="text-destructive" onClick={() => run(() => removeNotification(pref.id))} aria-label="Remove"><Trash2 /></Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {EVENT_ORDER.filter((e) => pref.events.includes(e)).map((e) => <Badge key={e}>{EVENT_LABELS[e]}</Badge>)}
      </div>
      {state.message && <FormMessage state={state} />}
    </li>
  );
}

export function NotificationSettings({ websiteId, prefs, canEdit, smtpReady }: { websiteId: string; prefs: NotificationPref[]; canEdit: boolean; smtpReady: boolean }) {
  const { state, onSubmit, pending } = useFormAction(addNotification.bind(null, websiteId));
  const [channel, setChannel] = useState<NotificationChannel>("EMAIL");
  const e = state.fieldErrors ?? {};
  return (
    <>
      {prefs.length > 0 ? (
        <ul className="border-b">{prefs.map((p) => <PrefRow key={p.id} pref={p} canEdit={canEdit} />)}</ul>
      ) : (
        <p className="border-b px-5 py-4 text-sm text-muted-foreground">Nobody is notified yet.</p>
      )}
      {!smtpReady && <p className="border-b bg-warning-soft px-5 py-2.5 text-[13px] text-warning">SMTP is not configured on this server, so email notifications will fail until SMTP_HOST and the related settings are set.</p>}
      {canEdit && (
        <form onSubmit={onSubmit} noValidate key={state.ok ? `ok-${prefs.length}` : "form"}>
          <CardContent className="grid gap-4 pt-5 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="sm:col-span-2"><FormMessage state={state} /></div>
            <Field id="channel" label="Channel">
              <NativeSelect id="channel" name="channel" value={channel} onChange={(ev) => setChannel(ev.target.value as NotificationChannel)}>
                <option value="EMAIL">Email</option>
                <option value="SLACK">Slack</option>
              </NativeSelect>
            </Field>
            <Field id="target" label={channel === "EMAIL" ? "Email address" : "Slack incoming-webhook URL"} hint={channel === "SLACK" ? "Stored encrypted; only its last characters are shown afterwards." : undefined} errors={e.target}>
              <Input {...describe("target", state)} type={channel === "EMAIL" ? "email" : "url"} defaultValue={state.ok ? "" : state.values?.target} placeholder={channel === "EMAIL" ? "seo-team@edstellar.com" : "https://hooks.slack.com/services/…"} className={channel === "SLACK" ? "font-mono text-[13px]" : undefined} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Notify about</legend>
              {e.events && <p className="mb-2 text-[13px] text-destructive">{e.events.join(" ")}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {EVENT_ORDER.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <Checkbox name="events" value={ev} defaultChecked={DEFAULT_EVENTS.includes(ev)} />
                    {EVENT_LABELS[ev]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2 flex items-center gap-3">
              <SubmitButton pending={pending} pendingText="Adding…">Add recipient</SubmitButton>
              <span className="text-[13px] text-muted-foreground">One digest per run, only when something changes: new, back, resolved or escalated issues.</span>
            </div>
          </CardContent>
        </form>
      )}
    </>
  );
}
