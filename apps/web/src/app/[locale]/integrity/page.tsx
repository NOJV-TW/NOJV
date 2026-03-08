import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { RuntimeStats } from "@/components/runtime-stats";
import { integrityCases } from "@/lib/demo-data";

export default async function IntegrityPage({
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
        <p className={shellClassNames.eyebrow}>{labels.navigation.integrity}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          Anti-cheat is an evidence graph, not a checkbox.
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          Tab switches, similarity clusters, IP changes, and shell violations land in the same
          case timeline so reviewers can reason about behavior instead of trusting a single
          score.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {integrityCases.map((item) => (
          <article className={`${shellClassNames.card} px-5 py-5`} key={item.caseId}>
            <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
              {item.state.replaceAll("_", " ")}
            </p>
            <h3 className="mt-2 text-2xl font-semibold">{item.userId}</h3>
            <p className="mt-4 text-sm text-[color:var(--color-muted)]">Case score</p>
            <p className="mt-1 text-4xl font-[family-name:var(--font-display)]">{item.score}</p>
            <p className="mt-4 text-sm text-[color:var(--color-muted)]">
              {item.signalCount} linked signals
            </p>
          </article>
        ))}
      </section>

      <RuntimeStats />
    </div>
  );
}
