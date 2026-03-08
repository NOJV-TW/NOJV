import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

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
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{labels.navigation.contests}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          Contest space is isolated from practice mode by data model and policy.
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          Contest participation owns its own telemetry thresholds, frozen scoreboard behavior,
          and escalation rules. Workspace sessions can still exist in contest mode, but they are
          bound to the participant context and command allowlist.
        </p>
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
              <span className={shellClassNames.badge}>contest zone</span>
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
