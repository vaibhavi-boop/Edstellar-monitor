-- AlterTable
ALTER TABLE "WebsiteConfiguration" ADD COLUMN     "hostAliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
