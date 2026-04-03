import { editorialRepo, problemRepo, submissionRepo } from "@nojv/db";
import type { Language } from "@nojv/core";

export async function findProblemIdBySlug(slug: string) {
  return problemRepo.findIdBySlug(slug);
}

export async function listEditorials(problemId: string) {
  return editorialRepo.listByProblemId(problemId);
}

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await submissionRepo.count({
    userId, problemId, status: "accepted", sampleOnly: false
  });
  return count > 0;
}

export async function upsertEditorial(
  userId: string,
  problemId: string,
  content: string,
  language: Language
) {
  return editorialRepo.upsert(userId, problemId, { content, language });
}
