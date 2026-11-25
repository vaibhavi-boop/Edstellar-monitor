import { z } from "zod";
import { lines } from "@/server/websites/schema";

export const API_FREQUENCIES = [60, 120, 240, 360, 720, 1440] as const;
export const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

/** "Name: value" lines → header object. Throws a readable message on bad lines. */
export function parseHeaderLines(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(value)) {
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`"${line.slice(0, 40)}" is not in the form Name: value`);
    const name = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/.test(name)) throw new Error(`"${name.slice(0, 40)}" is not a valid header name`);
    if (SECRET_HEADERS.has(name.toLowerCase())) throw new Error(`Put ${name} in the authentication fields, where it is stored encrypted`);
    if (val.length > 1000 || /[\r\n]/.test(val)) throw new Error(`The value of ${name} is too long or contains a line break`);
    out[name] = val;
  }
  if (Object.keys(out).length > 20) throw new Error("At most 20 headers");
  return out;
}

const fieldPath = z.string().regex(/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/, "Fields are dotted paths such as data.items.0.id");

export const apiEndpointSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name must be at most 80 characters"),
    url: z.string().trim().min(1, "Enter the endpoint URL").max(2000),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    headers: z.record(z.string(), z.string()),
    authType: z.enum(["NONE", "BEARER", "BASIC", "API_KEY_HEADER"]),
    authToken: z.string().max(4000),
    authUsername: z.string().max(200),
    authPassword: z.string().max(500),
    authHeader: z.string().max(100),
    authValue: z.string().max(4000),
    requestBody: z.string().max(10_000, "The request body can be at most 10,000 characters"),
    expectedStatus: z.coerce.number().int("Must be a whole number").min(100, "Use a status between 100 and 599").max(599, "Use a status between 100 and 599"),
    expectedFields: z.array(fieldPath).max(30, "At most 30 expected fields"),
    timeoutSeconds: z.coerce.number().int().min(1, "At least 1 second").max(60, "At most 60 seconds"),
    frequencyMinutes: z.coerce.number().refine((v) => (API_FREQUENCIES as readonly number[]).includes(v), "Choose one of the listed frequencies"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.requestBody && v.method === "GET") ctx.addIssue({ code: "custom", path: ["requestBody"], message: "GET requests cannot have a body; choose POST, PUT or PATCH" });
    if (v.authType === "API_KEY_HEADER" && v.authHeader && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/.test(v.authHeader)) {
      ctx.addIssue({ code: "custom", path: ["authHeader"], message: "Not a valid header name" });
    }
  });

export type ApiEndpointInput = z.infer<typeof apiEndpointSchema>;

export function apiEndpointFromForm(form: FormData): { data?: Record<string, unknown>; headerError?: string } {
  let headers: Record<string, string> = {};
  try {
    headers = parseHeaderLines(form.get("headers"));
  } catch (error) {
    return { headerError: error instanceof Error ? error.message : "Invalid headers" };
  }
  const s = (k: string) => String(form.get(k) ?? "");
  return {
    data: {
      name: s("name"),
      url: s("url"),
      method: s("method"),
      headers,
      authType: s("authType") || "NONE",
      authToken: s("authToken"),
      authUsername: s("authUsername"),
      authPassword: s("authPassword"),
      authHeader: s("authHeader").trim(),
      authValue: s("authValue"),
      requestBody: s("requestBody").trim(),
      expectedStatus: s("expectedStatus"),
      expectedFields: lines(form.get("expectedFields")),
      timeoutSeconds: s("timeoutSeconds"),
      frequencyMinutes: s("frequencyMinutes"),
      isActive: form.get("isActive") === "on",
    },
  };
}

/**
 * The credential to store, as JSON for encryption. `null` = no credential;
 * `undefined` = keep the stored one (editing with the secret fields left blank).
 */
export function credentialFor(v: ApiEndpointInput, hasStored: boolean, storedType: string | null): { json: string | null | undefined; error?: [string, string] } {
  switch (v.authType) {
    case "NONE":
      return { json: null };
    case "BEARER":
      if (v.authToken) return { json: JSON.stringify({ token: v.authToken }) };
      return hasStored && storedType === "BEARER" ? { json: undefined } : { json: undefined, error: ["authToken", "Enter the bearer token"] };
    case "BASIC":
      if (v.authUsername && v.authPassword) return { json: JSON.stringify({ username: v.authUsername, password: v.authPassword }) };
      if (!v.authUsername && !v.authPassword && hasStored && storedType === "BASIC") return { json: undefined };
      return { json: undefined, error: [v.authUsername ? "authPassword" : "authUsername", "Enter both the username and the password"] };
    case "API_KEY_HEADER":
      if (v.authHeader && v.authValue) return { json: JSON.stringify({ header: v.authHeader, value: v.authValue }) };
      if (!v.authValue && hasStored && storedType === "API_KEY_HEADER") return { json: undefined };
      return { json: undefined, error: [v.authHeader ? "authValue" : "authHeader", "Enter the header name and the key"] };
  }
}
