#!/usr/bin/env node
/**
 * Data migration: move inline validator script bodies out of the
 * Problem.judgeConfig JSON column into object storage.
 *
 * Before Phase 3, checkerScript / interactorScript were persisted inline in
 * judgeConfig (each up to 200KB). They now live in storage; judgeConfig keeps
 * only checkerKey / interactorKey. This script backfills existing rows.
 *
 * There is no Prisma schema column change (the change is inside the Json?
 * shape), so this is a node data-move rather than a .sql migration — a SQL
 * migration cannot upload to S3.
 *
 * Idempotent: rows already carrying a key (and no inline body) are skipped.
 * Run with:
 *
 *   pnpm --filter @nojv/db migrate:validator-scripts
 *
 * Note: the repo's standing strategy for file-asset moves of this kind is
 * "wipe + re-seed" (no production user data — see
 * docs/plans/completed/2026-04-13-testcase-blob-storage-design.md). A fresh
 * `pnpm db:seed` already produces the new shape. This script exists for any
 * live database that must preserve authored problems.
 */
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

    const hasInlineChecker = typeof checkerScript === "string" && checkerScript.trim().length > 0;
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
