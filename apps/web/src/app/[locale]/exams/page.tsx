import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { deriveAssessmentWindowState } from "@/lib/server/course-poc-helpers";
import { listUserAssessments } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ExamsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("examsList");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return (
      <div className="space-y-6">
        <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
          <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
        </section>
        <p className="text-sm text-[color:var(--color-muted)]">{t("signInRequired")}</p>
      </div>
    );
  }

  const exams = await listUserAssessments(userId, "exam");
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
      </section>

      {exams.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{t("empty")}</p>
      )}

      <section className="grid gap-4">
        {exams.map((e) => {
          const windowState = deriveAssessmentWindowState({
            closesAt: e.closesAt,
            dueAt: e.dueAt,
            now,
            opensAt: e.opensAt
          });

          return (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center`}
              href={`/${locale}/courses/${e.courseSlug}/exams/${e.slug}`}
              key={`${e.courseSlug}-${e.slug}`}
            >
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{e.courseTitle}</p>
                <h3 className="mt-1 text-xl font-semibold">{e.title}</h3>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("opens")}</p>
                <p className="mt-1 text-sm">{new Date(e.opensAt).toLocaleDateString(locale)}</p>
              </div>
              <div>
                <p className="text-sm text-[color:var(--color-muted)]">{t("due")}</p>
                <p className="mt-1 text-sm">{new Date(e.dueAt).toLocaleDateString(locale)}</p>
              </div>
              <div className="sm:text-right">
                <span className={`${shellClassNames.badge} ${
                  windowState === "open" ? "text-emerald-600" :
                  windowState === "upcoming" ? "text-blue-600" :
                  windowState === "grace" ? "text-amber-600" :
                  "text-[color:var(--color-muted)]"
                }`}>
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
