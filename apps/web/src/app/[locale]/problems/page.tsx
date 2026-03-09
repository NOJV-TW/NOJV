import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
  setRequestLocale(locale);
  const [tNav, tCommon] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("common")
  ]);
  const problems = await listProblemCards();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {tNav('problems')}
        </h2>
      </section>

      <section className="grid gap-4">
        <ProblemCreationPanel />
        {problems.map((problem) => (
          <Link
            className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.8fr_0.8fr] sm:items-center`}
            href={`/${locale}/problems/${problem.slug}`}
            key={problem.slug}
          >
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                {problem.slug}
              </p>
              <h3 className="mt-2 text-2xl font-semibold">{problem.title}</h3>
            </div>
            <div>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon('difficulty')}</p>
              <p className="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon('acceptance')}</p>
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
