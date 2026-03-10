"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { attachProblemToCourseMutation } from "@/lib/client/course-management-client";
import type { CourseProblemCatalogEntry } from "@/lib/server/read-model";

interface ManageProblemsProps {
  courseSlug: string;
  courseTitle: string;
  problems: CourseProblemCatalogEntry[];
}

export function ManageProblems({ courseSlug, courseTitle, problems }: ManageProblemsProps) {
  const router = useRouter();
  const [problemSlug, setProblemSlug] = useState("");
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";

  async function handleAttachProblem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAttaching(true);
    setAttachError(null);
    setAttachStatus(null);

    try {
      await attachProblemToCourseMutation({
        courseSlug,
        problemSlug
      });
      setAttachStatus(`Attached ${problemSlug} to ${courseTitle}.`);
      setProblemSlug("");
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setAttachError(issue instanceof Error ? issue.message : "Problem attachment failed.");
    } finally {
      setIsAttaching(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Course Problems</h3>
          <span className={shellClassNames.badge}>{problems.length}</span>
        </div>
        <div className="mt-5 grid gap-3">
          {problems.map((problem) => (
            <article
              className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={problem.slug}
            >
              <div>
                <p className="text-lg font-semibold">{problem.title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {problem.summary}
                </p>
              </div>
              <div className="text-right">
                <span className={shellClassNames.badge}>{problem.visibility}</span>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  by {problem.authorHandle}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Attach Problem</h3>
        <form className="mt-4 grid gap-3" onSubmit={(event) => void handleAttachProblem(event)}>
          <input
            className={inputClassName}
            onChange={(event) => setProblemSlug(event.target.value)}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="problem-slug"
            required
            value={problemSlug}
          />
          <button
            className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isAttaching}
            type="submit"
          >
            {isAttaching ? "Attaching..." : "Attach Problem"}
          </button>
        </form>
        {attachStatus ? <p className="mt-4 text-sm text-emerald-700">{attachStatus}</p> : null}
        {attachError ? <p className="mt-4 text-sm text-red-700">{attachError}</p> : null}
      </section>
    </div>
  );
}
