import { CourseAssessmentPage } from "@/components/course-assessment-page";

export const dynamic = "force-dynamic";

export default function CourseAssignmentPage({
  params
}: {
  params: Promise<{ assessmentSlug: string; locale: string; slug: string }>;
}) {
  return <CourseAssessmentPage params={params} type="assignment" />;
}
