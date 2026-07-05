import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedAdmin } from "./seeds/admin";
import { seedProblems } from "./seeds/problems";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding production baseline (super admin + example problems)...");
  const adminId = await seedAdmin(prisma);
  await seedProblems(prisma, adminId);
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
