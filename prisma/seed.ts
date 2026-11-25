/**
 * Idempotent seed: creates the first administrator (if no admin exists) and
 * the Edstellar website with the default four-hour configuration.
 * Run with: npm run db:seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";
import { DEFAULT_USER_AGENT, EDSTELLAR_WEBSITE } from "../src/server/websites/defaults";

const db = new PrismaClient({ adapter: createPrismaAdapter() });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrator";

  let adminId: string | null = null;
  const existingAdmin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (existingAdmin) {
    adminId = existingAdmin.id;
    console.log(`Admin already exists (${existingAdmin.email}); skipping admin creation.`);
  } else {
    if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the first admin.");
    if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      throw new Error("SEED_ADMIN_PASSWORD needs at least 12 characters, including a letter and a number.");
    }
    const admin = await db.user.create({
      data: { email, name, role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) },
    });
    adminId = admin.id;
    await db.auditLog.create({ data: { actorId: null, action: "user.seeded_admin", entityType: "User", entityId: admin.id } });
    console.log(`Created admin ${email}. Remove SEED_ADMIN_PASSWORD from the environment now.`);
  }

  const website = await db.website.upsert({
    where: { domain: EDSTELLAR_WEBSITE.domain },
    update: {},
    create: {
      name: EDSTELLAR_WEBSITE.name,
      url: EDSTELLAR_WEBSITE.url,
      domain: EDSTELLAR_WEBSITE.domain,
      createdById: adminId,
      configuration: {
        create: {
          crawlFrequencyMinutes: 240,
          userAgent: DEFAULT_USER_AGENT,
          respectRobotsTxt: EDSTELLAR_WEBSITE.respectRobotsTxt,
          hostAliases: [...EDSTELLAR_WEBSITE.hostAliases],
        },
      },
    },
    include: { configuration: true },
  });
  if (!website.configuration) {
    await db.websiteConfiguration.create({
      data: {
        websiteId: website.id,
        userAgent: DEFAULT_USER_AGENT,
        respectRobotsTxt: EDSTELLAR_WEBSITE.respectRobotsTxt,
        hostAliases: [...EDSTELLAR_WEBSITE.hostAliases],
      },
    });
  }
  console.log(`Website ready: ${website.name} (${website.url}), checked every 4 hours.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
