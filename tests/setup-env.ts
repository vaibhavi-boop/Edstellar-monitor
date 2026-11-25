/**
 * Database tests run against TEST_DATABASE_URL, never the database the app
 * uses. In CI (CI=true) the workflow's disposable DATABASE_URL is used. Locally
 * without TEST_DATABASE_URL, DATABASE_URL is removed so those tests skip.
 */
import { config } from "dotenv";

config({ quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else if (!process.env.CI) delete process.env.DATABASE_URL;
