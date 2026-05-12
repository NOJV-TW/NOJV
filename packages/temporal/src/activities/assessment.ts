import { assignmentDomain } from "@nojv/domain";

export type AssessmentInfo = Awaited<ReturnType<typeof assignmentDomain.getAssessmentInfo>>;

export async function getAssessmentInfo(assessmentId: string) {
  return assignmentDomain.getAssessmentInfo(assessmentId);
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assignmentDomain.activateAssessment(assessmentId);
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assignmentDomain.closeAssessment(assessmentId);
}
