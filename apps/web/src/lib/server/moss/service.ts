import { prisma } from "@nojv/db";

import { createLogger } from "../logger";
import { getMossLanguage, submitToMoss, type MossFile } from "./client";

const logger = createLogger("plagiarism");

const MOSS_USER_ID = process.env.MOSS_USER_ID ?? "";

export interface SimilarityPair {
  linesMatched: number;
  mossUrl: string;
  problemId: string;
  similarity1: number;
  similarity2: number;
  userId1: string;
  userId2: string;
}

export interface PlagiarismResults {
  pairs: SimilarityPair[];
}

export type PlagiarismTarget =
  | { type: "courseAssessment"; id: string }
  | { type: "contest"; id: string };

export function plagiarismTargetFilter(target: PlagiarismTarget) {
  return target.type === "courseAssessment"
    ? { courseAssessmentId: target.id }
    : { contestId: target.id };
}

/**
 * Trigger a plagiarism check for a course assessment or contest.
 * Creates the report record immediately and runs the check in the background.
 * Returns the report ID.
 */
export async function triggerPlagiarismCheck(
  target: PlagiarismTarget,
  triggeredById: string
): Promise<string> {
  const report = await prisma.plagiarismReport.create({
    data: {
      ...plagiarismTargetFilter(target),
      status: "pending",
      triggeredById
    }
  });

  // Fire-and-forget: run the check in the background
  runPlagiarismCheck(report.id, target).catch((err: unknown) => {
    logger.error("Background plagiarism check crashed", {
      err: err instanceof Error ? err.message : String(err),
      reportId: report.id
    });
  });

  return report.id;
}

async function runPlagiarismCheck(reportId: string, target: PlagiarismTarget): Promise<void> {
  try {
    await prisma.plagiarismReport.update({
      data: { status: "running" },
      where: { id: reportId }
    });

    // Fetch all submissions for this assessment or contest
    const submissions = await prisma.submission.findMany({
      where: {
        ...plagiarismTargetFilter(target),
        status: "accepted"
      },
      select: {
        id: true,
        language: true,
        problemId: true,
        score: true,
        sourceCode: true,
        userId: true
      },
      orderBy: { score: "desc" }
    });

    if (submissions.length === 0) {
      await prisma.plagiarismReport.update({
        data: {
          completedAt: new Date(),
          results: { pairs: [] },
          status: "completed"
        },
        where: { id: reportId }
      });
      return;
    }

    // For each (userId, problemId) pair, keep only the best submission (highest score)
    const bestSubmissions = new Map<string, (typeof submissions)[number]>();
    for (const sub of submissions) {
      const key = `${sub.userId}::${sub.problemId}`;
      const existing = bestSubmissions.get(key);
      if (!existing || sub.score > existing.score) {
        bestSubmissions.set(key, sub);
      }
    }

    // Group by (problemId, mossLanguage)
    const groups = new Map<
      string,
      { problemId: string; mossLang: string; subs: (typeof submissions)[number][] }
    >();
    for (const sub of bestSubmissions.values()) {
      const mossLang = getMossLanguage(sub.language);
      if (!mossLang) continue;

      const groupKey = `${sub.problemId}::${mossLang}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = { mossLang, problemId: sub.problemId, subs: [] };
        groups.set(groupKey, group);
      }
      group.subs.push(sub);
    }

    const allPairs: SimilarityPair[] = [];
    let mossReportUrl: string | null = null;

    for (const group of groups.values()) {
      // Need at least 2 submissions to compare
      if (group.subs.length < 2) continue;

      const files: MossFile[] = group.subs.map((sub) => ({
        content: sub.sourceCode,
        displayName: `${sub.userId}_${sub.problemId}.${extensionForLang(sub.language)}`
      }));

      let resultUrl: string;

      if (MOSS_USER_ID) {
        try {
          const result = await submitToMoss(MOSS_USER_ID, group.mossLang, files);
          resultUrl = result.url;
          mossReportUrl ??= resultUrl;
        } catch (err) {
          logger.warn("MOSS submission failed for group, skipping", {
            err: err instanceof Error ? err.message : String(err),
            mossLang: group.mossLang,
            problemId: group.problemId
          });
          continue;
        }
      } else {
        // MOSS_USER_ID not set; produce placeholder results
        resultUrl = `https://moss.stanford.edu/results/placeholder/${reportId}`;
        mossReportUrl ??= resultUrl;
        logger.info("MOSS_USER_ID not set, using placeholder results");
      }

      // Generate pairwise entries from the group
      // Without parsing the actual MOSS HTML results, we record each pair with placeholder similarities
      // When MOSS is available, these would be parsed from the result page
      const pairs = generatePairsFromGroup(group.subs, group.problemId, resultUrl);
      allPairs.push(...pairs);
    }

    const results = { pairs: allPairs } satisfies PlagiarismResults;

    await prisma.plagiarismReport.update({
      data: {
        completedAt: new Date(),
        mossReportUrl,
        results: JSON.parse(JSON.stringify(results)),
        status: "completed"
      },
      where: { id: reportId }
    });

    logger.info("Plagiarism check completed", { pairCount: allPairs.length, reportId });
  } catch (err) {
    logger.error("Plagiarism check failed", {
      err: err instanceof Error ? err.message : String(err),
      reportId
    });

    await prisma.plagiarismReport
      .update({
        data: { completedAt: new Date(), status: "failed" },
        where: { id: reportId }
      })
      .catch(() => {
        // Swallow update error during failure handling
      });
  }
}

function extensionForLang(language: string): string {
  const map: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "js",
    python: "py",
    rust: "rs",
    typescript: "ts"
  };
  return map[language] ?? "txt";
}

/**
 * Generate pairwise similarity entries for all submissions in a group.
 * When MOSS_USER_ID is not set, similarity values default to 0 (placeholder).
 * When MOSS is actually used, a future enhancement would parse the MOSS HTML results page.
 */
function generatePairsFromGroup(
  subs: { userId: string; problemId: string; sourceCode: string }[],
  problemId: string,
  mossUrl: string
): SimilarityPair[] {
  const pairs: SimilarityPair[] = [];

  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const a = subs[i];
      const b = subs[j];
      if (!a || !b) continue;

      pairs.push({
        linesMatched: 0,
        mossUrl,
        problemId,
        similarity1: 0,
        similarity2: 0,
        userId1: a.userId,
        userId2: b.userId
      });
    }
  }

  return pairs;
}
