import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

// TODO: replace with DB-driven listContestCards() once Phase 1 merges
import { contestCards } from "@/lib/demo-data";

export default async function ContestsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {labels.navigation.contests}
        </h2>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {contestCards.map((contest) => (
          <Link
            className={`${shellClassNames.card} px-6 py-6`}
            href={`/${currentLocale}/contests/${contest.slug}`}
            key={contest.slug}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {contest.mode}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{contest.title}</h3>
              </div>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">Starts</dt>
                <dd className="mt-1 text-lg font-semibold">{contest.startsAt}</dd>
              </div>
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">Ends</dt>
                <dd className="mt-1 text-lg font-semibold">{contest.endsAt}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>
    </div>
  );
}
