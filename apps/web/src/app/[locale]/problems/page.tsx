import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { ProblemCreationPanel } from "@/components/problem-creation-panel";
import { ProblemsTabs } from "@/components/problems-tabs";
import { auth } from "@/lib/auth";
import { listEditableProblems, listProblemCards } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tNav = await getTranslations("navigation");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  const [publicProblems, editableProblems] = await Promise.all([
    listProblemCards(),
    userId ? listEditableProblems(userId) : Promise.resolve(null)
  ]);

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {tNav("problems")}
        </h2>
      </section>

      <ProblemCreationPanel />
      <ProblemsTabs editableProblems={editableProblems} publicProblems={publicProblems} />
    </div>
  );
}
