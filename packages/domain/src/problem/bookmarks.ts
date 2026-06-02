import { problemBookmarkRepo, problemRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";

export async function isBookmarked(userId: string, problemId: string): Promise<boolean> {
  const row = await problemBookmarkRepo.isBookmarked(userId, problemId);
  return row !== null;
}

export async function toggleBookmark(
  userId: string,
  problemId: string,
): Promise<{ bookmarked: boolean }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);

  const existing = await problemBookmarkRepo.isBookmarked(userId, problemId);
  if (existing) {
    await problemBookmarkRepo.remove(userId, problemId);
    return { bookmarked: false };
  }
  await problemBookmarkRepo.add(userId, problemId);
  return { bookmarked: true };
}
