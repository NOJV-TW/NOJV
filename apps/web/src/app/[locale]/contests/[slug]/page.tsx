import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

import { getContestPageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ContestDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [tNav, tCommon, tContest] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("common"),
    getTranslations("contestDetail")
  ]);
  const contest = await getContestPageData(slug);

  if (!contest) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className={shellClassNames.eyebrow}>
              {tNav('contests')} / {contest.slug}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {contest.title}
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
              {contest.summary}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tContest('scoreboard')}</p>
              <p className="mt-2 text-lg font-semibold">
                {contest.frozenScoreboard ? tContest('frozen') : tContest('live')}
              </p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tNav('problems')}</p>
              <p className="mt-2 text-lg font-semibold">{contest.problems.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={shellClassNames.eyebrow}>{tContest('contestProblems')}</p>
              <h3 className={shellClassNames.sectionTitle}>{tNav('problems')}</h3>
            </div>
            <span className={shellClassNames.badge}>{contest.problems.length} {tContest('problems')}</span>
          </div>
          <div className="mt-5 space-y-3">
            {contest.problems.map((problem) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
                href={`/${locale}/problems/${problem.slug}?contest=${contest.slug}`}
                key={problem.slug}
              >
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {problem.slug}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                </div>
                <span className={shellClassNames.badge}>{problem.points} {tContest('pts')}</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>{tCommon('timeline')}</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
              <p>{tCommon('starts')}: {new Date(contest.startsAt).toLocaleString()}</p>
              <p>{tCommon('ends')}: {new Date(contest.endsAt).toLocaleString()}</p>
              <p>{tContest('scoreboard')}: {contest.frozenScoreboard ? tContest('freezeAware') : tContest('liveRanked')}</p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
