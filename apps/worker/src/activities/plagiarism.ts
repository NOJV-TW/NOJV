import { log } from "@temporalio/activity";

import { Dolos } from "@dodona/dolos-lib";
import { File } from "@dodona/dolos-core";

import { plagiarismDomain } from "@nojv/domain";

type PlagiarismTargetType = "courseAssessment" | "exam" | "contest";

const DOLOS_LANGUAGE_MAP: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "javascript",
  python: "python",
  rust: "rust",
  typescript: "typescript",
};

function extensionForLang(language: string): string {
  const map: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "js",
    python: "py",
    rust: "rs",
    typescript: "ts",
  };
  return map[language] ?? "txt";
}

interface PlagiarismGroup {
  problemId: string;
  dolosLang: string;
  subs: plagiarismDomain.PlagiarismSubmission[];
}

function selectBestSubmissions(
  submissions: plagiarismDomain.PlagiarismSubmission[],
): Map<string, plagiarismDomain.PlagiarismSubmission> {
  const bestSubmissions = new Map<string, plagiarismDomain.PlagiarismSubmission>();
  for (const sub of submissions) {
    const key = `${sub.userId}::${sub.problemId}`;
    const existing = bestSubmissions.get(key);
    if (!existing || sub.score > existing.score) {
      bestSubmissions.set(key, sub);
    }
  }
  return bestSubmissions;
}

function groupSubmissionsByLanguage(
  bestSubmissions: Map<string, plagiarismDomain.PlagiarismSubmission>,
): Map<string, PlagiarismGroup> {
  const groups = new Map<string, PlagiarismGroup>();
  for (const sub of bestSubmissions.values()) {
    const dolosLang = DOLOS_LANGUAGE_MAP[sub.language];
    if (!dolosLang) continue;

    const groupKey = `${sub.problemId}::${dolosLang}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { dolosLang, problemId: sub.problemId, subs: [] };
      groups.set(groupKey, group);
    }
    group.subs.push(sub);
  }
  return groups;
}

async function analyzeGroup(
  group: PlagiarismGroup,
): Promise<plagiarismDomain.SimilarityPair[]> {
  if (group.subs.length < 2) return [];

  const files = group.subs.map(
    (sub) => new File(`${sub.userId}.${extensionForLang(sub.language)}`, sub.sourceCode),
  );

  let report;
  try {
    report = await new Dolos({ language: group.dolosLang }).analyze(files);
  } catch (err) {
    log.warn("Dolos analyze failed, skipping group", {
      problemId: group.problemId,
      language: group.dolosLang,
      submissions: group.subs.length,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return report.allPairs().map((pair) => ({
    problemId: group.problemId,
    userId1: pair.leftEntry.file.path.replace(/\..+$/, ""),
    userId2: pair.rightEntry.file.path.replace(/\..+$/, ""),
    similarity: Math.round(pair.similarity * 100),
    longest: pair.longest,
    overlap: pair.overlap,
  }));
}

export async function runPlagiarismCheck(
  targetId: string,
  targetType: PlagiarismTargetType,
): Promise<void> {
  const target: plagiarismDomain.PlagiarismTarget = { type: targetType, id: targetId };
  await plagiarismDomain.updateReportStatus(target, "running");

  try {
    const submissions = await plagiarismDomain.listSubmissionsForCheck(target);

    if (submissions.length === 0) {
      await plagiarismDomain.saveResults(target, { pairs: [] }, null);
      return;
    }

    const bestSubmissions = selectBestSubmissions(submissions);
    const groups = groupSubmissionsByLanguage(bestSubmissions);

    const allPairs: plagiarismDomain.SimilarityPair[] = [];
    for (const group of groups.values()) {
      allPairs.push(...(await analyzeGroup(group)));
    }

    await plagiarismDomain.saveResults(target, { pairs: allPairs }, null);
  } catch (err) {
    await plagiarismDomain.markReportFailed(target).catch((markErr: unknown) => {
      log.error("markReportFailed also failed; report may be stuck in 'running'", {
        targetType: target.type,
        targetId: target.id,
        originalErr: err instanceof Error ? err.message : String(err),
        markErr: markErr instanceof Error ? markErr.message : String(markErr),
      });
    });

    throw err;
  }
}
