import { getTranslations, setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { RuntimeStats } from "@/components/runtime-stats";
import { listIntegrityCases } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function IntegrityPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tIntegrity = await getTranslations("integrity");
  const integrityCases = await listIntegrityCases();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">
          {tIntegrity("heading")}
        </h2>
        <p className="mt-2 text-base text-[color:var(--color-muted)]">
          {tIntegrity("subtitle")}
        </p>
      </section>

      {integrityCases.length === 0 ? (
        <section className={`${shellClassNames.card} px-6 py-6`}>
          <p className="text-[color:var(--color-muted)]">{tIntegrity("empty")}</p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-3">
          {integrityCases.map((item) => (
            <article className={`${shellClassNames.card} px-5 py-5`} key={item.caseId}>
              <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                {item.state.replaceAll("_", " ")}
              </p>
              <h3 className="mt-2 text-2xl font-semibold">{item.userId}</h3>
              <p className="mt-4 text-sm text-[color:var(--color-muted)]">{tIntegrity("caseScore")}</p>
              <p className="mt-1 text-4xl font-[family-name:var(--font-display)]">{item.score}</p>
              <p className="mt-4 text-sm text-[color:var(--color-muted)]">
                {item.signalCount} {tIntegrity("linkedSignals")}
              </p>
            </article>
          ))}
        </section>
      )}

      <RuntimeStats />
    </div>
  );
}
