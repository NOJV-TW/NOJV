import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { ForbiddenError, NotFoundError, ValidationError, plagiarismDomain } from "@nojv/domain";
import { userRepo } from "@nojv/db";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { buildPairKey, findPlagiarismReport, getPlagiarismSourceCode, listFlagsForContext } =
  plagiarismDomain;

interface RawPair {
  userId1: string;
  userId2: string;
  problemId: string;
  similarity: number;
  longest: number;
  overlap: number;
}

function parsePairs(raw: unknown): RawPair[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { pairs?: unknown };
  if (!Array.isArray(obj.pairs)) return [];
  return obj.pairs
    .map((p: unknown): RawPair | null => {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      if (
        typeof o.userId1 !== "string" ||
        typeof o.userId2 !== "string" ||
        typeof o.problemId !== "string" ||
        typeof o.similarity !== "number"
      ) {
        return null;
      }
      return {
        userId1: o.userId1,
        userId2: o.userId2,
        problemId: o.problemId,
        similarity: o.similarity,
        longest: typeof o.longest === "number" ? o.longest : 0,
        overlap: typeof o.overlap === "number" ? o.overlap : 0,
      };
    })
    .filter((p): p is RawPair => p !== null);
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  requireAuth(event);
  const parent = await event.parent();
  const { assessment, isManager } = parent;
  if (!isManager) {
    throw new ForbiddenError("Only course staff can view plagiarism diff.");
  }

  const { pairId } = event.params;
  let pairKey: string;
  try {
    pairKey = decodeURIComponent(pairId);
  } catch {
    throw new ValidationError("Invalid pair id.");
  }
  const parts = pairKey.split("|");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new ValidationError("Invalid pair key.");
  }
  const [userAId, userBId, problemId] = parts as [string, string, string];

  // Defensive normalisation: even if the URL was hand-edited, recompute the
  // canonical key so we lookup the same flag row the API would write.
  const canonicalPairKey = buildPairKey(userAId, userBId, problemId);

  const target = { type: "courseAssessment" as const, id: assessment.id };

  const [report, leftSource, rightSource, flags, leftUser, rightUser] = await Promise.all([
    findPlagiarismReport(target).catch(() => null),
    getPlagiarismSourceCode(target, userAId, problemId),
    getPlagiarismSourceCode(target, userBId, problemId),
    listFlagsForContext("assessment", assessment.id),
    userRepo.findById(userAId),
    userRepo.findById(userBId),
  ]);

  const pair = report
    ? (parsePairs(report.results).find(
        (p) => buildPairKey(p.userId1, p.userId2, p.problemId) === canonicalPairKey,
      ) ?? null)
    : null;

  if (!pair) {
    throw new NotFoundError("Pair not found in this assessment's report.");
  }

  const flag = flags.find((f) => f.pairKey === canonicalPairKey) ?? null;

  return {
    pair: {
      similarity: pair.similarity,
      longest: pair.longest,
      overlap: pair.overlap,
      problemId: pair.problemId,
    },
    pairKey: canonicalPairKey,
    contextType: "assessment" as const,
    contextId: assessment.id,
    left: {
      userId: userAId,
      displayName: leftUser?.name ?? null,
      username: leftUser?.username ?? null,
      sourceCode: leftSource,
    },
    right: {
      userId: userBId,
      displayName: rightUser?.name ?? null,
      username: rightUser?.username ?? null,
      sourceCode: rightSource,
    },
    flag: flag
      ? {
          id: flag.id,
          flaggedBy: flag.flaggedBy,
          flaggedAt: flag.flaggedAt.toISOString(),
          note: flag.note,
        }
      : null,
  };
});
