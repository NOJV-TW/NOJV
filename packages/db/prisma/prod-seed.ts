import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedAdmin } from "./seeds/admin";
import { seedProblems } from "./seeds/problems";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the production seed`);
  return value;
}

async function main() {
  console.log("Seeding production baseline (super admin + example problems)...");
  const adminId = await seedAdmin(prisma);
  await seedProblems(prisma, adminId, {
    advancedDemoImages: {
      run: requiredEnvironment("SEED_ADVANCED_RUN_IMAGE"),
      grade: requiredEnvironment("SEED_ADVANCED_GRADE_IMAGE"),
    },
  });
  console.log("Production seed complete.");
}

try {
  await main();
} catch (error) {
  console.error("Production seed failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
