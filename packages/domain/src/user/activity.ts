import { submissionRepo } from "@nojv/db";

export interface SubmissionActivityEvent {
  createdAt: Date;
  isAc: boolean;
}

// Raw submission timestamps for the dashboard activity surfaces (heatmap,
// streak, weekly trend). The dashboard buckets these into the viewer's
// local calendar day on the client — pre-aggregating here would force a
// UTC day boundary and shift squares for non-UTC users.
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
