import * as net from "node:net";

import { prisma, type Prisma } from "@nojv/db";

// --- Types ---

interface SimilarityPair {
  linesMatched: number;
  mossUrl: string;
  problemId: string;
  similarity1: number;
  similarity2: number;
  userId1: string;
  userId2: string;
}

interface PlagiarismResults {
  pairs: SimilarityPair[];
}

interface MossFile {
  content: string;
  displayName: string;
}

interface MossResult {
  url: string;
}

type PlagiarismTargetType = "courseAssessment" | "contest";

// --- Helpers ---

function plagiarismTargetFilter(targetType: PlagiarismTargetType, targetId: string) {
  return targetType === "courseAssessment"
    ? { courseAssessmentId: targetId }
    : { contestId: targetId };
}

const MOSS_LANGUAGE_MAP: Record<string, string> = {
  c: "c",
  cpp: "cc",
  go: "c",
  java: "java",
  javascript: "javascript",
  python: "python",
  rust: "c",
  typescript: "javascript"
};

function getMossLanguage(nojvLanguage: string): string | null {
  return MOSS_LANGUAGE_MAP[nojvLanguage] ?? null;
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

function submitToMoss(
  userId: string,
  language: string,
  files: MossFile[],
  maxMatches = 250
): Promise<MossResult> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = "";

    socket.setTimeout(120_000);

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("MOSS connection timed out"));
    });

    socket.on("error", (err) => {
      reject(new Error(`MOSS connection error: ${err.message}`));
    });

    socket.connect(7690, "moss.stanford.edu", () => {
      socket.write(`moss ${userId}\n`);
      socket.write("directory 0\n");
      socket.write("X 0\n");
      socket.write(`language ${language}\n`);
    });

    let handshakeDone = false;
    let fileIndex = 0;

    socket.on("data", (data) => {
      const text = data.toString();

      if (!handshakeDone) {
        if (text.trim() === "no") {
          socket.destroy();
          reject(new Error("MOSS rejected the language or user ID"));
          return;
        }

        if (text.includes("yes")) {
          handshakeDone = true;

          for (const file of files) {
            fileIndex++;
            const size = Buffer.byteLength(file.content, "utf8");
            socket.write(
              `file ${String(fileIndex)} ${language} ${String(size)} ${file.displayName}\n`
            );
            socket.write(file.content);
          }

          socket.write(`query 0 ${String(maxMatches)}\n`);
        }
        return;
      }

      responseData += text;
    });

    socket.on("end", () => {
      const url = responseData.trim();
      if (url.startsWith("http")) {
        socket.write("end\n");
        resolve({ url });
      } else {
        reject(new Error(`MOSS returned unexpected response: ${url}`));
      }
    });

    socket.on("close", () => {
      if (responseData.trim().startsWith("http")) {
        resolve({ url: responseData.trim() });
      }
    });
  });
}

// --- Activity ---

export async function runPlagiarismCheck(
  reportId: string,
  targetId: string,
  targetType: PlagiarismTargetType
): Promise<void> {
  await prisma.plagiarismReport.update({
    data: { status: "running" },
    where: { id: reportId }
  });

  const report = { id: reportId };

  try {
    const submissions = await prisma.submission.findMany({
      where: {
        ...plagiarismTargetFilter(targetType, targetId),
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
        where: { id: report.id }
      });
      return;
    }

    // For each (userId, problemId) pair, keep only the best submission
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
    const mossUserId = process.env.MOSS_USER_ID ?? "";

    for (const group of groups.values()) {
      if (group.subs.length < 2) continue;

      let resultUrl: string;

      if (mossUserId) {
        const files: MossFile[] = group.subs.map((sub) => ({
          content: sub.sourceCode,
          displayName: `${sub.userId}_${sub.problemId}.${extensionForLang(sub.language)}`
        }));

        try {
          const result = await submitToMoss(mossUserId, group.mossLang, files);
          resultUrl = result.url;
          mossReportUrl ??= resultUrl;
        } catch {
          continue;
        }
      } else {
        resultUrl = `https://moss.stanford.edu/results/placeholder/${report.id}`;
        mossReportUrl ??= resultUrl;
      }

      // Generate pairwise entries
      for (let i = 0; i < group.subs.length; i++) {
        for (let j = i + 1; j < group.subs.length; j++) {
          const a = group.subs[i];
          const b = group.subs[j];
          if (!a || !b) continue;

          allPairs.push({
            linesMatched: 0,
            mossUrl: resultUrl,
            problemId: group.problemId,
            similarity1: 0,
            similarity2: 0,
            userId1: a.userId,
            userId2: b.userId
          });
        }
      }
    }

    const results = { pairs: allPairs } satisfies PlagiarismResults;

    await prisma.plagiarismReport.update({
      data: {
        completedAt: new Date(),
        mossReportUrl,
        results: JSON.parse(JSON.stringify(results)) as Prisma.InputJsonValue,
        status: "completed"
      },
      where: { id: report.id }
    });
  } catch (err) {
    await prisma.plagiarismReport
      .update({
        data: { completedAt: new Date(), status: "failed" },
        where: { id: report.id }
      })
      .catch(() => {});

    throw err;
  }
}
