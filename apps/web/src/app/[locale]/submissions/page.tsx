import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { auth } from "@/auth";
import { listUserSubmissions } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  accepted: "Accepted",
  compile_error: "Compile Error",
  compiling: "Compiling",
  memory_limit_exceeded: "MLE",
  queued: "Queued",
  running: "Running",
  runtime_error: "Runtime Error",
  time_limit_exceeded: "TLE",
  wrong_answer: "Wrong Answer"
};

const statusColor: Record<string, string> = {
  accepted: "text-green-700",
  compile_error: "text-red-600",
  memory_limit_exceeded: "text-red-600",
  queued: "text-[color:var(--color-muted)]",
  runtime_error: "text-red-600",
  time_limit_exceeded: "text-red-600",
  wrong_answer: "text-red-600"
};

function formatLanguage(lang: string) {
  const map: Record<string, string> = {
    c: "C",
    cpp: "C++",
    java: "Java",
    javascript: "JavaScript",
    python: "Python",
    rust: "Rust",
    typescript: "TypeScript"
  };

  return map[lang] ?? lang;
}

export default async function SubmissionsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);

  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{labels.navigation.submissions}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {currentLocale === "zh-TW" ? "請先登入以查看提交紀錄。" : "Please sign in to view submissions."}
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
          {currentLocale === "zh-TW" ? "你的提交紀錄" : "Your Submissions"}
        </h2>
      </section>

      {submissions.length === 0 ? (
        <section className={`${shellClassNames.card} px-6 py-8 sm:px-8`}>
          <p className="text-[color:var(--color-muted)]">
            {currentLocale === "zh-TW" ? "尚無提交紀錄。" : "No submissions yet."}
          </p>
        </section>
      ) : (
        <section className={`${shellClassNames.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-xs uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  <th className="px-5 py-3 font-semibold">
                    {currentLocale === "zh-TW" ? "題目" : "Problem"}
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    {currentLocale === "zh-TW" ? "語言" : "Language"}
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    {currentLocale === "zh-TW" ? "狀態" : "Status"}
                  </th>
                  <th className="px-5 py-3 font-semibold text-right">
                    {currentLocale === "zh-TW" ? "分數" : "Score"}
                  </th>
                  <th className="px-5 py-3 font-semibold text-right">
                    {currentLocale === "zh-TW" ? "執行時間" : "Runtime"}
                  </th>
                  <th className="px-5 py-3 font-semibold text-right">
                    {currentLocale === "zh-TW" ? "提交時間" : "Date"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr
                    className="border-b border-[color:var(--color-border)] last:border-0"
                    key={submission.id}
                  >
                    <td className="px-5 py-4 font-medium">{submission.problem.defaultTitle}</td>
                    <td className="px-5 py-4">{formatLanguage(submission.language)}</td>
                    <td className={`px-5 py-4 font-semibold ${statusColor[submission.status] ?? ""}`}>
                      {statusLabel[submission.status] ?? submission.status}
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
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
