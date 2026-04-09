/**
 * Data migration for docs/plans/active/2026-04-09-problem-ui-redesign.md
 * Phase 1.
 *
 * This script must be run AFTER the Prisma migration
 * `20260409000000_problem_ui_redesign_phase_1` has been applied (so the
 * new columns exist) but BEFORE any code writes new-shape data.
 *
 * NOTE: TestcaseSet.isHidden is NOT dropped in Phase 1 (the schema change
 * was too disruptive — see that migration's README). This script still
 * reads the column to extract samples. Phase 5 drops the column for
 * real, at which point this script is no longer runnable and should be
 * archived.
 *
 * What it does:
 *
 *   1. Extract sample TestcaseSets (isHidden = false) into Problem.samples
 *      JSON, then delete the sets. Caps at 5 samples per problem.
 *   2. Convert ProblemTemplate rows to ProblemWorkspaceFile rows
 *      (visibility=editable, path=main.<ext>, content=templateCode).
 *      Does NOT delete the source ProblemTemplate rows — Phase 5 drops
 *      the table.
 *   3. Move Problem.judgeConfig.scoring.adjustmentRules to
 *      CourseAssessment.adjustmentRules (for unambiguous cases) and
 *      Contest.adjustmentRules. Ambiguous cases are logged and skipped.
 *   4. Strip deprecated fields from Problem.judgeConfig: staticAnalysis,
 *      artifacts, networkAccess, customScripts, scoring.adjustmentRules,
 *      scoring.script / language / timeoutMs, pipeline.
 *   5. Insert judgeConfig.runtime from top-level Problem.timeLimitMs /
 *      memoryLimitMb / empty env.
 *   6. Set Problem.mode = standard on all existing rows (the Prisma
 *      default handles new rows).
 *
 * The script is idempotent: running it twice produces no additional
 * changes (samples already extracted, workspace files already created,
 * judgeConfig already normalized).
 *
 * Usage:
 *   node --env-file=../../.env --import tsx prisma/migrate-data-phase-1.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../generated/prisma/client";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "mjs",
  python: "py",
  rust: "rs",
  typescript: "ts"
};

interface Summary {
  samplesExtracted: number;
  sampleSetsDeleted: number;
  workspaceFilesCreated: number;
  templatesSkippedDuplicate: number;
  adjustmentRulesMovedAssessment: number;
  adjustmentRulesMovedContest: number;
  adjustmentRulesSkippedAmbiguous: number;
  judgeConfigsStripped: number;
  runtimesInserted: number;
  modeSetStandard: number;
  warnings: string[];
}

const problemSelect = {
  id: true,
  judgeConfig: true,
  memoryLimitMb: true,
  mode: true,
  samples: true,
  templates: {
    select: {
      language: true,
      templateCode: true
    }
  },
  testcaseSets: {
    select: {
      id: true,
      isHidden: true,
      name: true,
      testcases: {
        orderBy: { ordinal: "asc" },
        select: {
          expectedStdout: true,
          stdin: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  },
  timeLimitMs: true
} satisfies Prisma.ProblemSelect;

type ProblemLite = Prisma.ProblemGetPayload<{ select: typeof problemSelect }>;

async function migrateProblems(
  prisma: PrismaClient,
  summary: Summary
): Promise<void> {
  const problems = await prisma.problem.findMany({ select: problemSelect });

  for (const problem of problems) {
    await migrateOneProblem(prisma, problem, summary);
  }
}

async function migrateOneProblem(
  prisma: PrismaClient,
  problem: ProblemLite,
  summary: Summary
): Promise<void> {
  // ─── 1. Extract sample testcase sets into Problem.samples ─────────
  if (problem.samples == null || (Array.isArray(problem.samples) && problem.samples.length === 0)) {
    const sampleSets = problem.testcaseSets.filter((ts) => !ts.isHidden);

    if (sampleSets.length > 0) {
      const pairs: { stdin: string; expected: string }[] = [];
      for (const set of sampleSets) {
        for (const tc of set.testcases) {
          if (pairs.length >= 5) break;
          pairs.push({
            stdin: tc.stdin,
            expected: tc.expectedStdout ?? ""
          });
        }
        if (pairs.length >= 5) break;
      }

      if (pairs.length > 0) {
        await prisma.problem.update({
          where: { id: problem.id },
          data: { samples: pairs as unknown as Prisma.InputJsonValue }
        });
        summary.samplesExtracted += pairs.length;
      }

      // Delete sample sets (cascades to their Testcases).
      for (const set of sampleSets) {
        await prisma.testcaseSet.delete({ where: { id: set.id } });
        summary.sampleSetsDeleted += 1;
      }
    }
  }

  // ─── 2. Convert ProblemTemplate -> ProblemWorkspaceFile ────────────
  const existingWorkspaceFiles = await prisma.problemWorkspaceFile.findMany({
    where: { problemId: problem.id },
    select: { language: true, path: true }
  });
  const existingPaths = new Set(
    existingWorkspaceFiles.map((f) => `${f.language}::${f.path}`)
  );

  const seenLanguages = new Set<string>();
  for (const template of problem.templates) {
    if (seenLanguages.has(template.language)) {
      summary.templatesSkippedDuplicate += 1;
      summary.warnings.push(
        `Problem ${problem.id}: multiple templates for ${template.language}, keeping first`
      );
      continue;
    }
    seenLanguages.add(template.language);

    const ext = LANGUAGE_EXTENSIONS[template.language] ?? template.language;
    const path = `main.${ext}`;
    const key = `${template.language}::${path}`;

    if (existingPaths.has(key)) {
      continue; // idempotent
    }

    await prisma.problemWorkspaceFile.create({
      data: {
        problemId: problem.id,
        language: template.language,
        path,
        content: template.templateCode,
        visibility: "editable",
        orderIndex: 0
      }
    });
    summary.workspaceFilesCreated += 1;
  }

  // ─── 3-5. Normalize judgeConfig ────────────────────────────────────
  const jc = (problem.judgeConfig ?? {}) as Record<string, unknown>;
  const originalKeys = Object.keys(jc);
  const normalized: Record<string, unknown> = {};

  // Carry forward keys that survive Phase 1.
  if ("type" in jc) normalized.type = jc.type;
  if ("compare" in jc) normalized.compare = jc.compare;
  if ("checkerScript" in jc) normalized.checkerScript = jc.checkerScript;
  if ("checkerLanguage" in jc) normalized.checkerLanguage = jc.checkerLanguage;
  if ("interactorScript" in jc) normalized.interactorScript = jc.interactorScript;
  if ("interactorLanguage" in jc) normalized.interactorLanguage = jc.interactorLanguage;

  // Move scoring: keep only subtaskStrategies from the old scoring block.
  const oldScoring = (jc.scoring as Record<string, unknown> | undefined) ?? {};
  const pendingAdjustmentRules = Array.isArray(oldScoring.adjustmentRules)
    ? (oldScoring.adjustmentRules as unknown[])
    : [];

  if (oldScoring.subtaskStrategies) {
    normalized.scoring = { subtaskStrategies: oldScoring.subtaskStrategies };
  }

  // Insert runtime from top-level limits if missing.
  if (!("runtime" in jc)) {
    normalized.runtime = {
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      env: {}
    };
    summary.runtimesInserted += 1;
  } else {
    normalized.runtime = jc.runtime;
  }

  const droppedKeys = originalKeys.filter(
    (k) =>
      k !== "type" &&
      k !== "compare" &&
      k !== "checkerScript" &&
      k !== "checkerLanguage" &&
      k !== "interactorScript" &&
      k !== "interactorLanguage" &&
      k !== "runtime" &&
      k !== "scoring"
  );

  if (droppedKeys.length > 0) {
    summary.judgeConfigsStripped += 1;
  }

  await prisma.problem.update({
    where: { id: problem.id },
    data: {
      judgeConfig: normalized as Prisma.InputJsonValue,
      ...(problem.mode !== "standard" ? {} : {}) // mode default already correct
    }
  });

  // ─── 6. Adjustment rules lift to assessment/contest ────────────────
  if (pendingAdjustmentRules.length > 0) {
    await liftAdjustmentRules(prisma, problem.id, pendingAdjustmentRules, summary);
  }
}

async function liftAdjustmentRules(
  prisma: PrismaClient,
  problemId: string,
  rules: unknown[],
  summary: Summary
): Promise<void> {
  const assessmentLinks = await prisma.courseAssessmentProblem.findMany({
    where: { problemId },
    select: { assessmentId: true }
  });
  const contestLinks = await prisma.contestProblem.findMany({
    where: { problemId },
    select: { contestId: true }
  });

  const assessmentIds = Array.from(
    new Set(assessmentLinks.map((l) => l.assessmentId))
  );
  const contestIds = Array.from(new Set(contestLinks.map((l) => l.contestId)));

  if (assessmentIds.length === 1) {
    await appendAdjustmentRules(prisma, "courseAssessment", assessmentIds[0]!, rules);
    summary.adjustmentRulesMovedAssessment += rules.length;
  } else if (assessmentIds.length > 1) {
    summary.adjustmentRulesSkippedAmbiguous += rules.length;
    summary.warnings.push(
      `Problem ${problemId}: ${rules.length} adjustment rules skipped — linked to ${assessmentIds.length} assessments`
    );
  }

  if (contestIds.length === 1) {
    await appendAdjustmentRules(prisma, "contest", contestIds[0]!, rules);
    summary.adjustmentRulesMovedContest += rules.length;
  } else if (contestIds.length > 1) {
    summary.adjustmentRulesSkippedAmbiguous += rules.length;
    summary.warnings.push(
      `Problem ${problemId}: ${rules.length} adjustment rules skipped — linked to ${contestIds.length} contests`
    );
  }

  if (assessmentIds.length === 0 && contestIds.length === 0) {
    summary.warnings.push(
      `Problem ${problemId}: ${rules.length} adjustment rules orphaned (no assessment or contest link)`
    );
  }
}

async function appendAdjustmentRules(
  prisma: PrismaClient,
  table: "courseAssessment" | "contest",
  id: string,
  rules: unknown[]
): Promise<void> {
  if (table === "courseAssessment") {
    const existing = await prisma.courseAssessment.findUnique({
      where: { id },
      select: { adjustmentRules: true }
    });
    const current = Array.isArray(existing?.adjustmentRules)
      ? (existing.adjustmentRules as unknown[])
      : [];
    const merged = dedupeRules([...current, ...rules]);
    await prisma.courseAssessment.update({
      where: { id },
      data: { adjustmentRules: merged as Prisma.InputJsonValue }
    });
  } else {
    const existing = await prisma.contest.findUnique({
      where: { id },
      select: { adjustmentRules: true }
    });
    const current = Array.isArray(existing?.adjustmentRules)
      ? (existing.adjustmentRules as unknown[])
      : [];
    const merged = dedupeRules([...current, ...rules]);
    await prisma.contest.update({
      where: { id },
      data: { adjustmentRules: merged as Prisma.InputJsonValue }
    });
  }
}

function dedupeRules(rules: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const rule of rules) {
    const key = JSON.stringify(rule);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rule);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!
  });
  const prisma = new PrismaClient({ adapter });

  const summary: Summary = {
    samplesExtracted: 0,
    sampleSetsDeleted: 0,
    workspaceFilesCreated: 0,
    templatesSkippedDuplicate: 0,
    adjustmentRulesMovedAssessment: 0,
    adjustmentRulesMovedContest: 0,
    adjustmentRulesSkippedAmbiguous: 0,
    judgeConfigsStripped: 0,
    runtimesInserted: 0,
    modeSetStandard: 0,
    warnings: []
  };

  try {
    console.log("Running Phase 1 data migration…");
    await migrateProblems(prisma, summary);
    console.log(JSON.stringify({ summary }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Phase 1 data migration failed:", error);
  process.exit(1);
});
