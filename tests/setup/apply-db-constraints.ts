/**
 * Apply DB-level constraints that Prisma schema can't express directly.
 * Invoked by `tests/setup/global-setup.ts` after every `prisma db push`
 * so the test DB matches production invariants. Idempotent.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client.js";

const CONSTRAINTS: { name: string; kind: "constraint" | "index"; sql: string }[] = [
  {
    name: "Problem_special_env_image_coherent",
    kind: "constraint",
    sql: `ALTER TABLE "Problem" ADD CONSTRAINT "Problem_special_env_image_coherent"
          CHECK (
            (type = 'special_env') = (
              "advancedImageRef" IS NOT NULL AND "advancedImageSource" IS NOT NULL
            )
          );`
  },
  {
    name: "PlagiarismReport_xor_parent",
    kind: "constraint",
    sql: `ALTER TABLE "PlagiarismReport" ADD CONSTRAINT "PlagiarismReport_xor_parent"
          CHECK (("contestId" IS NULL) != ("courseAssessmentId" IS NULL));`
  },
  {
    name: "Submission_context_by_mode",
    kind: "constraint",
    sql: `ALTER TABLE "Submission" ADD CONSTRAINT "Submission_context_by_mode"
          CHECK (
            (mode = 'practice'   AND "contestId" IS NULL AND "courseAssessmentId" IS NULL) OR
            (mode = 'contest'    AND "contestId" IS NOT NULL) OR
            (mode = 'assignment' AND "courseAssessmentId" IS NOT NULL)
          );`
  },
  {
    name: "Problem_tags_gin_idx",
    kind: "index",
    sql: `CREATE INDEX "Problem_tags_gin_idx" ON "Problem" USING GIN ("tags");`
  }
];

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!
  });
  const prisma = new PrismaClient({ adapter });

  for (const c of CONSTRAINTS) {
    const exists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      c.kind === "constraint"
        ? `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS "exists"`
        : `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS "exists"`,
      c.name
    );
    if (exists[0]?.exists) continue;
    await prisma.$executeRawUnsafe(c.sql);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("apply-db-constraints failed:", err);
  process.exit(1);
});
