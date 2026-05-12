import { editorialRepo, submissionRepo } from "@nojv/db";

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await submissionRepo.count({
    userId,
    problemId,
    status: "accepted",
    sampleOnly: false,
  });
  return count > 0;
}

export async function listProblemEditorials(problemId: string) {
  return editorialRepo.listByProblemId(problemId);
}

export interface ListEditorialsPageInput {
  problemId: string;
  page: number;
  pageSize: number;
}

/**
 * Paginated read for the dedicated editorial list page. Returns the
 * page slice plus the total count so the UI can render page controls.
 */
export async function listEditorialsPage({
  problemId,
  page,
  pageSize,
}: ListEditorialsPageInput) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const skip = (safePage - 1) * safeSize;
  const [items, total] = await Promise.all([
    editorialRepo.listByProblemIdPaged(problemId, skip, safeSize),
    editorialRepo.countByProblemId(problemId),
  ]);
  return { items, total, page: safePage, pageSize: safeSize };
}

// intentional-nullable: edit-page loader maps null to the standard 404; mutations promote it to NotFoundError. Caller chooses the error so this stays a plain "row not visible" signal.
export async function getEditorialById(id: string) {
  const row = await editorialRepo.findById(id);
  if (!row || row.deletedAt) return null;
  return row;
}
