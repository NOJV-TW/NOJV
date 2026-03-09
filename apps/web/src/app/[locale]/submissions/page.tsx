import Link from "next/link";

import { headers } from "next/headers";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { listUserSubmissions } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  accepted: "text-green-700",
  compile_error: "text-red-600",
  compiling: "text-[color:var(--color-muted)]",
  memory_limit_exceeded: "text-red-600",
  queued: "text-[color:var(--color-muted)]",
  running: "text-[color:var(--color-muted)]",
  runtime_error: "text-red-600",
  time_limit_exceeded: "text-red-600",
  wrong_answer: "text-red-600"
};

const languageDisplay: Record<string, string> = {
  c: "C",
  cpp: "C++",
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  typescript: "TypeScript"
};

export default async function SubmissionsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [tNav, tSub] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("submissions")
  ]);
  const statusLabels: Record<string, string> = {
    accepted: tSub("accepted"),
    compile_error: tSub("compileError"),
    compiling: tSub("compiling"),
    memory_limit_exceeded: tSub("mle"),
    queued: tSub("queued"),
    running: tSub("running"),
    runtime_error: tSub("runtimeError"),
    time_limit_exceeded: tSub("tle"),
    wrong_answer: tSub("wrongAnswer")
  };

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return (
      <div className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{tNav("submissions")}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {tSub("signInRequired")}
        </h2>
      </div>
    );
  }

  const submissions = await listUserSubmissions(session.user.id);

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{tNav("submissions")}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {tSub("heading")}
        </h2>
      </section>

      {submissions.length === 0 ? (
        <section className={`${shellClassNames.card} px-6 py-8 sm:px-8`}>
          <p className="text-[color:var(--color-muted)]">{tSub("empty")}</p>
        </section>
      ) : (
        <section className={`${shellClassNames.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-xs uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  <th className="px-5 py-3 font-semibold">{tSub("problem")}</th>
                  <th className="px-5 py-3 font-semibold">{tSub("language")}</th>
                  <th className="px-5 py-3 font-semibold">{tSub("status")}</th>
                  <th className="px-5 py-3 font-semibold text-right">{tSub("score")}</th>
                  <th className="px-5 py-3 font-semibold text-right">{tSub("runtime")}</th>
                  <th className="px-5 py-3 font-semibold text-right">{tSub("date")}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  return (
                    <tr
                      className="border-b border-[color:var(--color-border)] last:border-0"
                      key={submission.id}
                    >
                      <td className="px-5 py-4 font-medium">
                        <Link
                          className="hover:underline"
                          href={`/${locale}/problems/${submission.problem.slug}`}
                        >
                          {submission.problem.defaultTitle}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        {languageDisplay[submission.language] ?? submission.language}
                      </td>
                      <td className={`px-5 py-4 font-semibold ${statusColors[submission.status] ?? ""}`}>
                        {statusLabels[submission.status] ?? submission.status}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums">{submission.score}</td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        {submission.runtimeMs != null ? `${String(submission.runtimeMs)} ms` : "—"}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[color:var(--color-muted)]">
                        {submission.createdAt.toLocaleDateString(locale, {
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          month: "2-digit",
                          year: "numeric"
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
