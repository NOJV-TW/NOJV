import { AssessmentListPage } from "@/components/assessment-list-page";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  return AssessmentListPage({ i18nNamespace: "assignmentsList", params, type: "assignment" });
}
