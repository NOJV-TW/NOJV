import { assessmentDomain } from "@nojv/domain";

export type AssessmentInfo = Awaited<ReturnType<typeof assessmentDomain.getAssessmentInfo>>;

export async function getAssessmentInfo(assessmentId: string) {
  return assessmentDomain.getAssessmentInfo(assessmentId);
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assessmentDomain.activateAssessment(assessmentId);
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assessmentDomain.closeAssessment(assessmentId);
}
