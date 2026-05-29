#!/usr/bin/env node
import { checkerKey, createStorageClient, interactorKey, putText } from "@nojv/storage";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const storage = createStorageClient();

async function main() {
  const problems = await prisma.problem.findMany({
    select: { id: true, judgeConfig: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const problem of problems) {
    const config = problem.judgeConfig;
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      skipped++;
      continue;
    }

    const record = config as Record<string, unknown>;
    const checkerScript = record.checkerScript;
    const interactorScript = record.interactorScript;

    const hasInlineChecker =
      typeof checkerScript === "string" && checkerScript.trim().length > 0;
    const hasInlineInteractor =
      typeof interactorScript === "string" && interactorScript.trim().length > 0;

    if (!hasInlineChecker && !hasInlineInteractor) {
      skipped++;
      continue;
    }

    const { checkerScript: _c, interactorScript: _i, ...rest } = record;
    const next: Record<string, unknown> = { ...rest };

    if (hasInlineChecker) {
      const key = checkerKey(problem.id);
      await putText(storage, key, checkerScript as string);
      next.checkerKey = key;
    }
    if (hasInlineInteractor) {
      const key = interactorKey(problem.id);
      await putText(storage, key, interactorScript as string);
      next.interactorKey = key;
    }

    await prisma.problem.update({
      where: { id: problem.id },
      data: { judgeConfig: next as object },
    });
    migrated++;
    console.log(`migrated ${problem.id}`);
  }

  console.log(`Done. migrated=${String(migrated)} skipped=${String(skipped)}`);
}

main()
  .catch((err: unknown) => {
    console.error("Validator-script migration failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
