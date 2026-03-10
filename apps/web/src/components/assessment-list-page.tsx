import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import type { CourseAssessmentType } from "@nojv/domain";
import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import {
  deriveAssessmentWindowState,
  windowStateColorClass
} from "@/lib/server/course-assessment-helpers";
import { listUserAssessments } from "@/lib/server/read-model";

export async function AssessmentListPage({
  i18nNamespace,
  params,
  type
}: {
  i18nNamespace: string;
  params: Promise<{ locale: string }>;
  type: CourseAssessmentType;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations(i18nNamespace);

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;

  if (!userId) {
    return (
      <div className="space-y-6">
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
        <p className="text-sm text-[color:var(--color-muted)]">{t("signInRequired")}</p>
      </div>
    );
  }

  const items = await listUserAssessments(userId, type);
  const now = new Date().toISOString();
  const urlSegment = type === "assignment" ? "assignments" : "exams";

  return (
    <div className="space-y-6">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>

      {items.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{t("empty")}</p>
      )}

      <section className="grid gap-4">
        {items.map((a) => {
          const windowState = deriveAssessmentWindowState({
            closesAt: a.closesAt,
            dueAt: a.dueAt,
            now,
            opensAt: a.opensAt
          });

          return (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center`}
              href={`/${locale}/courses/${a.courseSlug}/${urlSegment}/${a.slug}`}
              key={`${a.courseSlug}-${a.slug}`}
            >
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{a.courseTitle}</p>
                <h3 className="mt-1 text-xl font-semibold">{a.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("opens")}</p>
                <p className="mt-1 text-sm">{new Date(a.opensAt).toLocaleDateString(locale)}</p>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("due")}</p>
                <p className="mt-1 text-sm">{new Date(a.dueAt).toLocaleDateString(locale)}</p>
              </div>
              <div className="sm:text-right">
                <span
                  className={`${shellClassNames.badge} ${windowStateColorClass(windowState)}`}
                >
                  {windowState}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
