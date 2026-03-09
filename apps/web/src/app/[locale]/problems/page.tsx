import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

import { ProblemCreationPanel } from "@/components/problem-creation-panel";
import { listProblemCards } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const problems = await listProblemCards();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {labels.navigation.problems}
        </h2>
      </section>

      <section className="grid gap-4">
        <ProblemCreationPanel locale={currentLocale} />
        {problems.map((problem) => (
          <Link
            className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.8fr_0.8fr] sm:items-center`}
            href={`/${currentLocale}/problems/${problem.slug}`}
            key={problem.slug}
          >
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                {problem.slug}
              </p>
              <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
            </div>
            <div>
              <p className="text-sm text-[color:var(--color-muted)]">Difficulty</p>
              <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm text-[color:var(--color-muted)]">Acceptance</p>
              <p className="mt-1 text-lg font-semibold">
                {formatAcceptanceRate(problem.acceptanceRate)}
              </p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
