import { prisma } from "@nojv/db";

export interface AssessmentInfo {
  closesAt: string;
  dueAt: string;
  opensAt: string;
}

export async function getAssessmentInfo(assessmentId: string): Promise<AssessmentInfo> {
  const assessment = await prisma.courseAssessment.findUniqueOrThrow({
    select: {
      closesAt: true,
      dueAt: true,
      opensAt: true
    },
    where: { id: assessmentId }
  });

  return {
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt.toISOString(),
    opensAt: assessment.opensAt.toISOString()
  };
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await prisma.courseAssessment.update({
    data: { status: "published" },
    where: { id: assessmentId }
  });
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await prisma.courseAssessment.update({
    data: { status: "archived" },
    where: { id: assessmentId }
  });
}
