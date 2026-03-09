import { AssessmentListPage } from "@/components/assessment-list-page";

export const dynamic = "force-dynamic";

export default async function ExamsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  return AssessmentListPage({ i18nNamespace: "examsList", params, type: "exam" });
}
