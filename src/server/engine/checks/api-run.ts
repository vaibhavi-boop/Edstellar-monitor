import type { PrismaClient } from "@/generated/prisma/client";
import { decryptSecret } from "@/server/security/crypto";
import type { FetchPolicy } from "../http";
import { apiAuthSchema, checkApi, type ApiAuth, type ApiCheckOutcome } from "./api";

type Endpoint = Awaited<ReturnType<PrismaClient["apiEndpoint"]["findUniqueOrThrow"]>>;

function readHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** Decrypts the stored credential. Throws if ENCRYPTION_KEY is missing or changed. */
export function readAuth(endpoint: Pick<Endpoint, "authType" | "encryptedAuth">): ApiAuth {
  if (endpoint.authType === "NONE" || !endpoint.encryptedAuth) return { type: "NONE" };
  return apiAuthSchema.parse({ type: endpoint.authType, ...JSON.parse(decryptSecret(endpoint.encryptedAuth)) });
}

/**
 * Checks one endpoint, stores an ApiCheckResult and stamps lastCheckedAt.
 * Shared by monitoring runs and the "Check now" button.
 */
export async function runEndpointCheck(
  db: PrismaClient,
  endpoint: Endpoint,
  policy: Pick<FetchPolicy, "userAgent" | "lookup" | "checkUrl">,
  monitoringRunId: string | null,
): Promise<ApiCheckOutcome> {
  let outcome: ApiCheckOutcome;
  let auth: ApiAuth | null = null;
  try {
    auth = readAuth(endpoint);
  } catch {
    outcome = {
      ok: false,
      statusCode: null,
      responseTimeMs: null,
      errorType: "api.auth_failure",
      errorMessage: "The stored credentials cannot be decrypted (is ENCRYPTION_KEY set to the key they were saved with?). Re-enter them.",
      missingFields: [],
    };
  }
  if (auth) {
    outcome = await checkApi(
      {
        url: endpoint.url,
        method: endpoint.method,
        headers: readHeaders(endpoint.headers),
        auth,
        body: endpoint.requestBody,
        expectedStatus: endpoint.expectedStatus,
        expectedFields: endpoint.expectedFields,
        timeoutMs: endpoint.timeoutMs,
      },
      policy,
    );
  }
  const now = new Date();
  await db.$transaction([
    db.apiCheckResult.create({
      data: {
        apiEndpointId: endpoint.id,
        monitoringRunId,
        ok: outcome!.ok,
        statusCode: outcome!.statusCode,
        responseTimeMs: outcome!.responseTimeMs,
        errorType: outcome!.errorType,
        errorMessage: outcome!.errorMessage?.slice(0, 1000) ?? null,
        missingFields: outcome!.missingFields,
        checkedAt: now,
      },
    }),
    db.apiEndpoint.update({ where: { id: endpoint.id }, data: { lastCheckedAt: now } }),
  ]);
  return outcome!;
}
