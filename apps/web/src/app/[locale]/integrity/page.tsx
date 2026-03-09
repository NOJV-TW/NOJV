import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { RuntimeStats } from "@/components/runtime-stats";
// TODO: replace with DB-driven listIntegrityCases() once Phase 1 merges
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
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {labels.integrity.heading}
        </h2>
        <p className="mt-2 text-base text-[color:var(--color-muted)]">
          {labels.integrity.subtitle}
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
