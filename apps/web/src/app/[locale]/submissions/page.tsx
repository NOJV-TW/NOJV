import Link from "next/link";

import { headers } from "next/headers";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { listUserSubmissions } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

const statusDisplay: Record<string, { color: string; label: string }> = {
  accepted: { color: "text-green-700", label: "Accepted" },
  compile_error: { color: "text-red-600", label: "Compile Error" },
  compiling: { color: "text-[color:var(--color-muted)]", label: "Compiling" },
  memory_limit_exceeded: { color: "text-red-600", label: "MLE" },
  queued: { color: "text-[color:var(--color-muted)]", label: "Queued" },
  running: { color: "text-[color:var(--color-muted)]", label: "Running" },
  runtime_error: { color: "text-red-600", label: "Runtime Error" },
  time_limit_exceeded: { color: "text-red-600", label: "TLE" },
  wrong_answer: { color: "text-red-600", label: "Wrong Answer" }
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
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return (
      <div className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{labels.navigation.submissions}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {labels.submissions.signInRequired}
        </h2>
      </div>
    );
  }

  const submissions = await listUserSubmissions(session.user.id);

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{labels.navigation.submissions}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {labels.submissions.heading}
        </h2>
      </section>

      {submissions.length === 0 ? (
        <section className={`${shellClassNames.card} px-6 py-8 sm:px-8`}>
          <p className="text-[color:var(--color-muted)]">{labels.submissions.empty}</p>
        </section>
      ) : (
        <section className={`${shellClassNames.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-xs uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  <th className="px-5 py-3 font-semibold">{labels.submissions.problem}</th>
                  <th className="px-5 py-3 font-semibold">{labels.submissions.language}</th>
                  <th className="px-5 py-3 font-semibold">{labels.submissions.status}</th>
                  <th className="px-5 py-3 font-semibold text-right">{labels.submissions.score}</th>
                  <th className="px-5 py-3 font-semibold text-right">{labels.submissions.runtime}</th>
                  <th className="px-5 py-3 font-semibold text-right">{labels.submissions.date}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  const display = statusDisplay[submission.status];

                  return (
                    <tr
                      className="border-b border-[color:var(--color-border)] last:border-0"
                      key={submission.id}
                    >
                      <td className="px-5 py-4 font-medium">
                        <Link
                          className="hover:underline"
                          href={`/${currentLocale}/problems/${submission.problem.slug}`}
                        >
                          {submission.problem.defaultTitle}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        {languageDisplay[submission.language] ?? submission.language}
                      </td>
                      <td className={`px-5 py-4 font-semibold ${display?.color ?? ""}`}>
                        {display?.label ?? submission.status}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums">{submission.score}</td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        {submission.runtimeMs != null ? `${String(submission.runtimeMs)} ms` : "—"}
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums text-[color:var(--color-muted)]">
                        {submission.createdAt.toLocaleDateString(currentLocale, {
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
