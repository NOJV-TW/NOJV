"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { publishCourseAssessmentMutation } from "@/lib/client/course-management-client";
import type { CourseAssessmentRecord } from "@/lib/server/read-model";

interface ManageAssessmentsProps {
  courseSlug: string;
  assessments: CourseAssessmentRecord[];
  problemSlugs: string[];
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
}

function createDefaultAssessmentWindow() {
  const opensAt = new Date();
  const dueAt = new Date(opensAt.getTime() + 1000 * 60 * 60 * 24 * 7);
  const closesAt = new Date(dueAt.getTime() + 1000 * 60 * 60 * 24);

  return {
    closesAt: toDateTimeLocalValue(closesAt),
    dueAt: toDateTimeLocalValue(dueAt),
    opensAt: toDateTimeLocalValue(opensAt)
  };
}

export function ManageAssessments({
  courseSlug,
  assessments,
  problemSlugs
}: ManageAssessmentsProps) {
  const router = useRouter();
  const defaultWindow = createDefaultAssessmentWindow();

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentSlug, setAssessmentSlug] = useState("");
  const [assessmentType, setAssessmentType] = useState<"assignment" | "exam">("assignment");
  const [assessmentSummary, setAssessmentSummary] = useState("");
  const [scoreboardMode, setScoreboardMode] = useState<"hidden" | "live" | "frozen">("hidden");
  const [problemSlugsText, setProblemSlugsText] = useState(problemSlugs.join(", "));
  const [opensAt, setOpensAt] = useState(defaultWindow.opensAt);
  const [dueAt, setDueAt] = useState(defaultWindow.dueAt);
  const [closesAt, setClosesAt] = useState(defaultWindow.closesAt);
  const [assessmentStatus, setAssessmentStatus] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  async function handlePublishAssessment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPublishing(true);
    setAssessmentError(null);
    setAssessmentStatus(null);

    try {
      await publishCourseAssessmentMutation({
        closesAt: new Date(closesAt).toISOString(),
        courseSlug,
        dueAt: new Date(dueAt).toISOString(),
        ipLockEnabled: false,
        opensAt: new Date(opensAt).toISOString(),
        pageLockEnabled: false,
        problemSlugs: problemSlugsText
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        scoreboardMode,
        slug: assessmentSlug,
        summary: assessmentSummary,
        title: assessmentTitle,
        type: assessmentType
      });
      setAssessmentStatus(`Published ${assessmentTitle}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setAssessmentError(issue instanceof Error ? issue.message : "Assessment publish failed.");
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Assessments</h3>
          <span className={shellClassNames.badge}>{assessments.length}</span>
        </div>
        <div className="mt-5 grid gap-3">
          {assessments.map((assessment) => (
            <article
              className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={assessment.slug}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {assessment.type}
                  </p>
                  <p className="mt-2 text-lg font-semibold">{assessment.title}</p>
                  <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                    {assessment.summary}
                  </p>
                </div>
                <span className={shellClassNames.badge}>
                  {assessment.problemSlugs.length} problems
                </span>
              </div>
              <p className="mt-3 text-sm text-[color:var(--color-muted)]">
                {assessment.opensAt.slice(0, 10)} → {assessment.closesAt.slice(0, 10)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Publish Assessment</h3>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void handlePublishAssessment(event)}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className={inputClassName}
              onChange={(event) => setAssessmentTitle(event.target.value)}
              placeholder="Assessment title"
              required
              value={assessmentTitle}
            />
            <input
              className={inputClassName}
              onChange={(event) => setAssessmentSlug(event.target.value)}
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              placeholder="assessment-slug"
              required
              value={assessmentSlug}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className={inputClassName}
              onChange={(event) =>
                setAssessmentType(event.target.value as "assignment" | "exam")
              }
              value={assessmentType}
            >
              <option value="assignment">assignment</option>
              <option value="exam">exam</option>
            </select>
            <select
              className={inputClassName}
              onChange={(event) =>
                setScoreboardMode(event.target.value as "hidden" | "live" | "frozen")
              }
              value={scoreboardMode}
            >
              <option value="hidden">hidden</option>
              <option value="live">live</option>
              <option value="frozen">frozen</option>
            </select>
          </div>
          <textarea
            className={textareaClassName}
            onChange={(event) => setAssessmentSummary(event.target.value)}
            placeholder="Assessment summary"
            required
            value={assessmentSummary}
          />
          <textarea
            className={textareaClassName}
            onChange={(event) => setProblemSlugsText(event.target.value)}
            placeholder="problem-one, problem-two"
            required
            value={problemSlugsText}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className={inputClassName}
              onChange={(event) => setOpensAt(event.target.value)}
              required
              type="datetime-local"
              value={opensAt}
            />
            <input
              className={inputClassName}
              onChange={(event) => setDueAt(event.target.value)}
              required
              type="datetime-local"
              value={dueAt}
            />
            <input
              className={inputClassName}
              onChange={(event) => setClosesAt(event.target.value)}
              required
              type="datetime-local"
              value={closesAt}
            />
          </div>
          <button
            className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isPublishing}
            type="submit"
          >
            {isPublishing ? "Publishing..." : "Publish Assessment"}
          </button>
        </form>
        {assessmentStatus ? (
          <p className="mt-4 text-sm text-emerald-700">{assessmentStatus}</p>
        ) : null}
        {assessmentError ? (
          <p className="mt-4 text-sm text-red-700">{assessmentError}</p>
        ) : null}
      </section>
    </div>
  );
}
