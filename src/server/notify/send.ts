import nodemailer, { type Transporter } from "nodemailer";

/**
 * Delivery. Email goes through the SMTP server in SMTP_*; Slack through an
 * incoming-webhook URL, which must be on hooks.slack.com (the URL is a secret
 * and is stored encrypted, and restricting the host keeps the monitor from
 * being pointed at arbitrary servers).
 */

export class DeliveryError extends Error {}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

let transport: Transporter | null = null;

function smtp(): Transporter {
  if (!smtpConfigured()) throw new DeliveryError("SMTP is not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD)");
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      secure: port === 465,
      requireTLS: port !== 465 && port !== 25,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transport;
}

export async function sendEmail(to: string, message: { subject: string; text: string; html: string }): Promise<void> {
  const from = process.env.NOTIFY_FROM_EMAIL?.trim() || "monitor@edstellar.com";
  try {
    await smtp().sendMail({ from: `Edstellar Monitor <${from}>`, to, subject: message.subject, text: message.text, html: message.html });
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError(`Email to ${to} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isSlackWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/") && !url.username && !url.port;
  } catch {
    return false;
  }
}

export async function sendSlack(webhookUrl: string, payload: { text: string; blocks?: unknown[] }, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!isSlackWebhook(webhookUrl)) throw new DeliveryError("Not a Slack incoming-webhook URL (https://hooks.slack.com/services/…)");
  const res = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => {
    throw new DeliveryError(`Slack request failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!res.ok) throw new DeliveryError(`Slack returned HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
