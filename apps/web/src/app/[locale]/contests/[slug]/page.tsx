import Link from "next/link";
import { notFound } from "next/navigation";

import { type LocaleCode } from "@nojv/domain";
import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { getContestDetail } from "@/lib/demo-data";

export default async function ContestDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const currentLocale: LocaleCode = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const contest = getContestDetail(slug);

  if (!contest) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className={shellClassNames.eyebrow}>
              {labels.navigation.contests} / {contest.slug}
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
              <p className="text-sm text-[color:var(--color-muted)]">Scoreboard</p>
              <p className="mt-2 text-lg font-semibold">
                {contest.frozenScoreboard ? "Frozen" : "Live"}
              </p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">Telemetry sensitivity</p>
              <p className="mt-2 text-lg font-semibold">{contest.telemetrySensitivity}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={shellClassNames.eyebrow}>Contest problems</p>
              <h3 className={shellClassNames.sectionTitle}>Problems</h3>
            </div>
            <span className={shellClassNames.badge}>{contest.mode}</span>
          </div>
          <div className="mt-5 space-y-3">
            {contest.problems.map((problem) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
                href={`/${currentLocale}/problems/${problem.slug}?contest=${contest.slug}`}
                key={problem.slug}
              >
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {problem.slug}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                </div>
                <span className={shellClassNames.badge}>{problem.points} pts</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Workspace policy</p>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              {contest.workspacePolicy}
            </p>
          </section>
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Timeline</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
              <p>Starts: {contest.startsAt}</p>
              <p>Ends: {contest.endsAt}</p>
              <p>Scoreboard: {contest.frozenScoreboard ? "freeze-aware" : "live-ranked"}</p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
