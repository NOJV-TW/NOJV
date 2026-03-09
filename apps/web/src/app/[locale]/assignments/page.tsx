import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { deriveAssessmentWindowState } from "@/lib/server/course-poc-helpers";
import { listUserAssessments } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("assignmentsList");

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

  const assignments = await listUserAssessments(userId, "assignment");
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-6 sm:px-8`}>
        <h2 className="font-[family-name:var(--font-display)] text-3xl">{t("heading")}</h2>
      </section>

      {assignments.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{t("empty")}</p>
      )}

      <section className="grid gap-4">
        {assignments.map((a) => {
          const windowState = deriveAssessmentWindowState({
            closesAt: a.closesAt,
            dueAt: a.dueAt,
            now,
            opensAt: a.opensAt
          });

          return (
            <Link
              className={`${shellClassNames.card} grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center`}
              href={`/${locale}/courses/${a.courseSlug}/assignments/${a.slug}`}
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
