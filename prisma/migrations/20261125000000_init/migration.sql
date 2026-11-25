-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "IssueCategory" AS ENUM ('AVAILABILITY', 'BROKEN_LINK', 'SEO', 'REDIRECT', 'API', 'PERFORMANCE', 'SSL', 'DNS', 'SITEMAP', 'ROBOTS');

-- CreateEnum
CREATE TYPE "OccurrenceKind" AS ENUM ('DETECTED', 'REDETECTED', 'RECURRED', 'AUTO_RESOLVED', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('FULL', 'INCREMENTAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('AVAILABILITY', 'SITEMAP', 'DISCOVERY', 'CRAWL', 'LINKS', 'SEO', 'API', 'REDIRECTS', 'SSL_DNS', 'PERFORMANCE', 'ISSUES', 'REPORT', 'NOTIFY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "UrlSource" AS ENUM ('SITEMAP', 'CRAWL', 'CANONICAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('UP', 'REDIRECT', 'CLIENT_ERROR', 'SERVER_ERROR', 'TIMEOUT', 'DNS_ERROR', 'SSL_ERROR', 'CONNECTION_ERROR', 'BLOCKED');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- CreateEnum
CREATE TYPE "ApiAuthType" AS ENUM ('NONE', 'BEARER', 'BASIC', 'API_KEY_HEADER');

-- CreateEnum
CREATE TYPE "PerformanceSource" AS ENUM ('HTTP', 'PAGESPEED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SLACK');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('WEBSITE_DOWN', 'CRITICAL_ISSUE', 'NEW_404', 'API_FAILURE', 'SSL_EXPIRY', 'PERFORMANCE_DEGRADATION', 'CRITICAL_RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteConfiguration" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "crawlFrequencyMinutes" INTEGER NOT NULL DEFAULT 240,
    "crawlDepth" INTEGER NOT NULL DEFAULT 10,
    "maxUrls" INTEGER NOT NULL DEFAULT 10000,
    "concurrentRequests" INTEGER NOT NULL DEFAULT 4,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "retryAttempts" INTEGER NOT NULL DEFAULT 3,
    "userAgent" TEXT NOT NULL DEFAULT 'EdstellarMonitor/1.0 (+https://www.edstellar.com)',
    "respectRobotsTxt" BOOLEAN NOT NULL DEFAULT true,
    "includeWwwVariant" BOOLEAN NOT NULL DEFAULT true,
    "includePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ignoredIssueTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keptQueryParams" TEXT[] DEFAULT ARRAY['page']::TEXT[],
    "expectedResponses" JSONB NOT NULL DEFAULT '[]',
    "sslWarningDays" INTEGER[] DEFAULT ARRAY[30, 15, 7, 3]::INTEGER[],
    "pageSpeedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebsiteConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredUrl" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "source" "UrlSource" NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "inSitemap" BOOLEAN NOT NULL DEFAULT false,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canonicalUrl" TEXT,
    "contentType" TEXT,
    "lastStatusCode" INTEGER,
    "lastAvailability" "Availability",
    "lastResponseTimeMs" INTEGER,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DiscoveredUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringRun" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "websiteId" TEXT NOT NULL,
    "trigger" "RunTrigger" NOT NULL,
    "scanType" "ScanType" NOT NULL DEFAULT 'FULL',
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "heartbeatAt" TIMESTAMPTZ(3),
    "urlsChecked" INTEGER NOT NULL DEFAULT 0,
    "newUrls" INTEGER NOT NULL DEFAULT 0,
    "newIssues" INTEGER NOT NULL DEFAULT 0,
    "updatedIssues" INTEGER NOT NULL DEFAULT 0,
    "resolvedIssues" INTEGER NOT NULL DEFAULT 0,
    "failedChecks" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "summary" JSONB,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringLock" (
    "websiteId" TEXT NOT NULL,
    "monitoringRunId" TEXT NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringLock_pkey" PRIMARY KEY ("websiteId")
);

-- CreateTable
CREATE TABLE "MonitoringJob" (
    "id" TEXT NOT NULL,
    "monitoringRunId" TEXT NOT NULL,
    "stage" "JobStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "cursor" JSONB,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MonitoringJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "monitoringRunId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "urlsQueued" INTEGER NOT NULL DEFAULT 0,
    "urlsCrawled" INTEGER NOT NULL DEFAULT 0,
    "urlsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlResult" (
    "id" TEXT NOT NULL,
    "crawlRunId" TEXT NOT NULL,
    "discoveredUrlId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "availability" "Availability" NOT NULL,
    "responseTimeMs" INTEGER,
    "redirectUrl" TEXT,
    "finalUrl" TEXT,
    "contentType" TEXT,
    "contentLength" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "websiteId" TEXT NOT NULL,
    "category" "IssueCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedUrl" TEXT,
    "sourceUrl" TEXT,
    "httpStatus" INTEGER,
    "severity" "Severity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'NEW',
    "details" JSONB,
    "firstDetectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "recurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMPTZ(3),
    "lastNotifiedAt" TIMESTAMPTZ(3),
    "assigneeId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueOccurrence" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "monitoringRunId" TEXT,
    "kind" "OccurrenceKind" NOT NULL,
    "fromStatus" "IssueStatus",
    "toStatus" "IssueStatus",
    "note" TEXT,
    "details" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiEndpoint" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "authType" "ApiAuthType" NOT NULL DEFAULT 'NONE',
    "encryptedAuth" TEXT,
    "requestBody" TEXT,
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "expectedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "frequencyMinutes" INTEGER NOT NULL DEFAULT 240,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApiEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCheckResult" (
    "id" TEXT NOT NULL,
    "apiEndpointId" TEXT NOT NULL,
    "monitoringRunId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "statusCode" INTEGER NOT NULL,
    "hops" INTEGER NOT NULL DEFAULT 1,
    "chain" JSONB NOT NULL DEFAULT '[]',
    "finalStatusCode" INTEGER,
    "isLoop" BOOLEAN NOT NULL DEFAULT false,
    "isHttpToHttps" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoAuditResult" (
    "id" TEXT NOT NULL,
    "discoveredUrlId" TEXT NOT NULL,
    "monitoringRunId" TEXT,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "metaDescriptionLength" INTEGER,
    "h1Count" INTEGER NOT NULL DEFAULT 0,
    "headings" JSONB,
    "canonicalUrl" TEXT,
    "robotsMeta" TEXT,
    "xRobotsTag" TEXT,
    "isIndexable" BOOLEAN NOT NULL DEFAULT true,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImage" TEXT,
    "twitterCard" TEXT,
    "schemaTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jsonLdValid" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoAuditResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceResult" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "discoveredUrlId" TEXT,
    "monitoringRunId" TEXT,
    "url" TEXT NOT NULL,
    "source" "PerformanceSource" NOT NULL,
    "dnsMs" INTEGER,
    "connectMs" INTEGER,
    "tlsMs" INTEGER,
    "ttfbMs" INTEGER,
    "totalMs" INTEGER,
    "htmlBytes" INTEGER,
    "lcpMs" INTEGER,
    "fcpMs" INTEGER,
    "cls" DOUBLE PRECISION,
    "inpMs" INTEGER,
    "performanceScore" INTEGER,
    "accessibilityScore" INTEGER,
    "bestPracticesScore" INTEGER,
    "seoScore" INTEGER,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SslCheck" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "monitoringRunId" TEXT,
    "hostname" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "issuer" TEXT,
    "subject" TEXT,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "daysRemaining" INTEGER,
    "dnsAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SslCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sitemap" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isIndex" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "urlCount" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "lastFetchedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sitemap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "target" TEXT,
    "encryptedTarget" TEXT,
    "events" "NotificationEvent"[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "issueId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipHash_createdAt_idx" ON "LoginAttempt"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Website_domain_key" ON "Website"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteConfiguration_websiteId_key" ON "WebsiteConfiguration"("websiteId");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_websiteId_isActive_idx" ON "DiscoveredUrl"("websiteId", "isActive");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_websiteId_lastStatusCode_idx" ON "DiscoveredUrl"("websiteId", "lastStatusCode");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_websiteId_lastCheckedAt_idx" ON "DiscoveredUrl"("websiteId", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredUrl_websiteId_normalizedUrl_key" ON "DiscoveredUrl"("websiteId", "normalizedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringRun_number_key" ON "MonitoringRun"("number");

-- CreateIndex
CREATE INDEX "MonitoringRun_websiteId_createdAt_idx" ON "MonitoringRun"("websiteId", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringRun_status_idx" ON "MonitoringRun"("status");

-- CreateIndex
CREATE INDEX "MonitoringJob_status_idx" ON "MonitoringJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringJob_monitoringRunId_stage_key" ON "MonitoringJob"("monitoringRunId", "stage");

-- CreateIndex
CREATE INDEX "CrawlRun_websiteId_startedAt_idx" ON "CrawlRun"("websiteId", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlResult_crawlRunId_idx" ON "CrawlResult"("crawlRunId");

-- CreateIndex
CREATE INDEX "CrawlResult_discoveredUrlId_checkedAt_idx" ON "CrawlResult"("discoveredUrlId", "checkedAt");

-- CreateIndex
CREATE INDEX "CrawlResult_availability_idx" ON "CrawlResult"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_number_key" ON "Issue"("number");

-- CreateIndex
CREATE INDEX "Issue_websiteId_status_idx" ON "Issue"("websiteId", "status");

-- CreateIndex
CREATE INDEX "Issue_websiteId_severity_idx" ON "Issue"("websiteId", "severity");

-- CreateIndex
CREATE INDEX "Issue_websiteId_category_idx" ON "Issue"("websiteId", "category");

-- CreateIndex
CREATE INDEX "Issue_websiteId_lastDetectedAt_idx" ON "Issue"("websiteId", "lastDetectedAt");

-- CreateIndex
CREATE INDEX "Issue_affectedUrl_idx" ON "Issue"("affectedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_websiteId_fingerprint_key" ON "Issue"("websiteId", "fingerprint");

-- CreateIndex
CREATE INDEX "IssueOccurrence_issueId_createdAt_idx" ON "IssueOccurrence"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiEndpoint_websiteId_isActive_idx" ON "ApiEndpoint"("websiteId", "isActive");

-- CreateIndex
CREATE INDEX "ApiCheckResult_apiEndpointId_checkedAt_idx" ON "ApiCheckResult"("apiEndpointId", "checkedAt");

-- CreateIndex
CREATE INDEX "ApiCheckResult_ok_checkedAt_idx" ON "ApiCheckResult"("ok", "checkedAt");

-- CreateIndex
CREATE INDEX "Redirect_websiteId_hops_idx" ON "Redirect"("websiteId", "hops");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_websiteId_sourceUrl_key" ON "Redirect"("websiteId", "sourceUrl");

-- CreateIndex
CREATE INDEX "SeoAuditResult_discoveredUrlId_checkedAt_idx" ON "SeoAuditResult"("discoveredUrlId", "checkedAt");

-- CreateIndex
CREATE INDEX "SeoAuditResult_title_idx" ON "SeoAuditResult"("title");

-- CreateIndex
CREATE INDEX "SeoAuditResult_metaDescription_idx" ON "SeoAuditResult"("metaDescription");

-- CreateIndex
CREATE INDEX "PerformanceResult_websiteId_checkedAt_idx" ON "PerformanceResult"("websiteId", "checkedAt");

-- CreateIndex
CREATE INDEX "PerformanceResult_discoveredUrlId_checkedAt_idx" ON "PerformanceResult"("discoveredUrlId", "checkedAt");

-- CreateIndex
CREATE INDEX "SslCheck_websiteId_checkedAt_idx" ON "SslCheck"("websiteId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sitemap_websiteId_url_key" ON "Sitemap"("websiteId", "url");

-- CreateIndex
CREATE INDEX "NotificationPreference_websiteId_isEnabled_idx" ON "NotificationPreference"("websiteId", "isEnabled");

-- CreateIndex
CREATE INDEX "Notification_websiteId_createdAt_idx" ON "Notification"("websiteId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_issueId_event_idx" ON "Notification"("issueId", "event");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteConfiguration" ADD CONSTRAINT "WebsiteConfiguration_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredUrl" ADD CONSTRAINT "DiscoveredUrl_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringLock" ADD CONSTRAINT "MonitoringLock_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlResult" ADD CONSTRAINT "CrawlResult_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlResult" ADD CONSTRAINT "CrawlResult_discoveredUrlId_fkey" FOREIGN KEY ("discoveredUrlId") REFERENCES "DiscoveredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOccurrence" ADD CONSTRAINT "IssueOccurrence_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOccurrence" ADD CONSTRAINT "IssueOccurrence_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOccurrence" ADD CONSTRAINT "IssueOccurrence_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiEndpoint" ADD CONSTRAINT "ApiEndpoint_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCheckResult" ADD CONSTRAINT "ApiCheckResult_apiEndpointId_fkey" FOREIGN KEY ("apiEndpointId") REFERENCES "ApiEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCheckResult" ADD CONSTRAINT "ApiCheckResult_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoAuditResult" ADD CONSTRAINT "SeoAuditResult_discoveredUrlId_fkey" FOREIGN KEY ("discoveredUrlId") REFERENCES "DiscoveredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoAuditResult" ADD CONSTRAINT "SeoAuditResult_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceResult" ADD CONSTRAINT "PerformanceResult_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceResult" ADD CONSTRAINT "PerformanceResult_discoveredUrlId_fkey" FOREIGN KEY ("discoveredUrlId") REFERENCES "DiscoveredUrl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceResult" ADD CONSTRAINT "PerformanceResult_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SslCheck" ADD CONSTRAINT "SslCheck_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SslCheck" ADD CONSTRAINT "SslCheck_monitoringRunId_fkey" FOREIGN KEY ("monitoringRunId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sitemap" ADD CONSTRAINT "Sitemap_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sitemap" ADD CONSTRAINT "Sitemap_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Sitemap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
