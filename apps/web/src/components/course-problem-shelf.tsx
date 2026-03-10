import Link from "next/link";

import { getLocale, getTranslations } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

import type { CourseProblemCatalogEntry } from "@/lib/server/read-model";

interface CourseProblemShelfProps {
  courseSlug: string;
  problems: CourseProblemCatalogEntry[];
}

export async function CourseProblemShelf({ courseSlug, problems }: CourseProblemShelfProps) {
  const locale = await getLocale();
  const t = await getTranslations("courseDetail");
  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{t("problemShelf")}</p>
          <h3 className="mt-1 text-2xl font-semibold">{t("problemShelfSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>
          {problems.length} {t("linkedProblems")}
        </span>
      </div>
      <div className="mt-5 grid gap-3">
        {problems.map((problem) => (
          <Link
            className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
            href={`/${locale}/problems/${problem.slug}?course=${courseSlug}`}
            key={problem.slug}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{problem.title}</p>
                <p className="mt-2 text-sm leading-7 text-[color:var(--color-muted)]">
                  {problem.summary}
                </p>
              </div>
              <div className="text-right">
                <span className={shellClassNames.badge}>{problem.visibility}</span>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {t("by")} {problem.authorHandle}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
