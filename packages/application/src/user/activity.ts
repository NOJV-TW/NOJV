import { submissionRepo } from "@nojv/db";

export interface SubmissionActivityEvent {
  createdAt: Date;
  isAc: boolean;
}

export async function getSubmissionActivity(
  userId: string,
  since: Date,
): Promise<SubmissionActivityEvent[]> {
  const rows = await submissionRepo.findMany({
    where: { userId, sampleOnly: false, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, status: true },
  });
  return rows.map((r) => ({
    createdAt: r.createdAt,
    isAc: r.status === "accepted",
  }));
}
