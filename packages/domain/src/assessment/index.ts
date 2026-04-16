import { assessmentRepo } from "@nojv/db";

export interface AssessmentInfo {
  closesAt: string;
  /** Nullable: assessments without a soft deadline have no late penalty. */
  dueAt: string | null;
  opensAt: string;
}

export async function getAssessmentInfo(assessmentId: string): Promise<AssessmentInfo> {
  const assessment = await assessmentRepo.findInfoById(assessmentId);

  return {
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt?.toISOString() ?? null,
    opensAt: assessment.opensAt.toISOString()
  };
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "published" });
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "archived" });
}
