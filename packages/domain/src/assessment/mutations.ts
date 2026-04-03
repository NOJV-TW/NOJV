import { assessmentRepo } from "@nojv/db";

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "published" });
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "archived" });
}
