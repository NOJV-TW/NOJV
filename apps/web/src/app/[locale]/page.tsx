import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { listAnnouncements, listUpcomingAssessments } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function LocaleHomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [tHome, tAuth] = await Promise.all([
    getTranslations("home"),
    getTranslations("auth")
  ]);

  const session = await auth.api.getSession({ headers: await headers() });
  const isLoggedIn = !!session?.user;
  const userId = session?.user.id;

  const [announcements, assessments] = await Promise.all([
    listAnnouncements(),
    userId ? listUpcomingAssessments(userId) : Promise.resolve([])
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: Announcements */}
      <section className={`${shellClassNames.card} px-6 py-6`}>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          {tHome("announcements")}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)]">
                <th className="pb-2 pr-4 font-medium text-[color:var(--color-muted)]">{tHome("date")}</th>
                <th className="pb-2 font-medium text-[color:var(--color-muted)]">{tHome("content")}</th>
              </tr>
            </thead>
            <tbody>
              {announcements.length === 0 && (
                <tr>
                  <td className="py-3 text-[color:var(--color-muted)]" colSpan={2}>
                    {tHome("noAnnouncements")}
                  </td>
                </tr>
              )}
              {announcements.map((a) => (
                <tr className="border-b border-[color:var(--color-border)] last:border-0" key={a.id}>
                  <td className="whitespace-nowrap py-3 pr-4 text-[color:var(--color-muted)]">
                    {new Date(a.createdAt).toLocaleDateString(locale)}
                  </td>
                  <td className="py-3">
                    <p className="font-medium">{a.title}{a.pinned ? " 📌" : ""}</p>
                    <p className="mt-0.5 text-[color:var(--color-muted)]">{a.content}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right: Login panel or Upcoming assessments */}
      {!isLoggedIn ? (
        <section className={`${shellClassNames.cardStrong} flex flex-col items-center justify-center gap-4 px-6 py-10 text-center`}>
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            NOJV
          </h2>
          <p className="max-w-sm text-[color:var(--color-muted)]">
            {tHome("productDescription")}
          </p>
          <div className="mt-2 flex gap-3">
            <Link
              className="rounded-full bg-[color:var(--color-accent)] px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
              href="/auth/signin"
            >
              {tAuth("signIn")}
            </Link>
            <Link
              className="rounded-full border border-[color:var(--color-border)] px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
              href="/auth/signup"
            >
              {tAuth("signUp")}
            </Link>
          </div>
        </section>
      ) : (
        <section className={`${shellClassNames.card} px-6 py-6`}>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            {tHome("upcomingAssessments")}
          </h2>
          <div className="mt-4 space-y-3">
            {assessments.length === 0 && (
              <p className="text-sm text-[color:var(--color-muted)]">{tHome("noAssessments")}</p>
            )}
            {assessments.map((a) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 transition hover:-translate-y-0.5"
                href={`/${locale}/courses/${a.courseSlug}/${a.type === "assignment" ? "assignments" : "exams"}/${a.slug}`}
                key={`${a.courseSlug}-${a.slug}`}
              >
                <div>
                  <p className="text-xs uppercase tracking-widest text-[color:var(--color-muted)]">
                    {a.courseTitle} · {a.type === "assignment" ? tHome("assignment") : tHome("exam")}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{a.title}</p>
                </div>
                <div className="text-right text-sm text-[color:var(--color-muted)]">
                  <p>{tHome("due")}</p>
                  <p className="font-medium text-[color:var(--color-ink)]">
                    {new Date(a.dueAt).toLocaleDateString(locale)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
