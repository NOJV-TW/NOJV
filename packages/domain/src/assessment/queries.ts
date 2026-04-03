import { assessmentRepo } from "@nojv/db";

export interface AssessmentInfo {
  closesAt: string;
  dueAt: string;
  opensAt: string;
}

export async function getAssessmentInfo(assessmentId: string): Promise<AssessmentInfo> {
  const assessment = await assessmentRepo.findInfoById(assessmentId);

  return {
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt.toISOString(),
    opensAt: assessment.opensAt.toISOString()
  };
}
