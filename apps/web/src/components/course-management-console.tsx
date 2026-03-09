"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import {
  attachProblemToCourseMutation,
  enrollCourseMemberMutation,
  joinCourseMutation,
  publishCourseAssessmentMutation
} from "@/lib/client/course-management-client";

import { useActorSession } from "./actor-session-provider";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
const textareaClassName = `${inputClassName} min-h-24 resize-y`;

interface CourseManagementConsoleProps {
  course: {
    joinChannels: {
      label: string;
      method: "join_code" | "manual_invite" | "qr_code";
      token: string;
    }[];
    problemSlugs: string[];
    slug: string;
    title: string;
  };
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

export function CourseManagementConsole({ course }: CourseManagementConsoleProps) {
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { actor } = useActorSession();
  const defaultWindow = createDefaultAssessmentWindow();
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [enrollName, setEnrollName] = useState("Carol Tsai");
  const [enrollEmail, setEnrollEmail] = useState("carol@nojv.local");
  const [enrollHandle, setEnrollHandle] = useState("stu_carol");
  const [enrollRole, setEnrollRole] = useState<"student" | "ta" | "teacher">("student");
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [problemSlug, setProblemSlug] = useState("");
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [assessmentTitle, setAssessmentTitle] = useState("Homework 1");
  const [assessmentSlug, setAssessmentSlug] = useState("hw1-course-release");
  const [assessmentType, setAssessmentType] = useState<"assignment" | "exam">("assignment");
  const [assessmentSummary, setAssessmentSummary] = useState(
    "First course release against the shared judge."
  );
  const [scoreboardMode, setScoreboardMode] = useState<"hidden" | "live" | "frozen">("hidden");
  const [problemSlugsText, setProblemSlugsText] = useState(course.problemSlugs.join(", "));
  const [opensAt, setOpensAt] = useState(defaultWindow.opensAt);
  const [dueAt, setDueAt] = useState(defaultWindow.dueAt);
  const [closesAt, setClosesAt] = useState(defaultWindow.closesAt);
  const [assessmentStatus, setAssessmentStatus] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [isPublishingAssessment, setIsPublishingAssessment] = useState(false);

  async function handleJoin(joinMethod: "join_code" | "qr_code", joinToken: string) {
    setIsJoining(true);
    setJoinError(null);
    setJoinStatus(null);

    try {
      await joinCourseMutation(
        {
          courseSlug: course.slug,
          joinMethod,
          joinToken
        },
        actor
      );
      setJoinStatus(`Joined ${course.title} as ${actor.displayName}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setJoinError(issue instanceof Error ? issue.message : "Course join failed.");
    } finally {
      setIsJoining(false);
    }
  }

  async function handleManualEnrollment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsEnrolling(true);
    setEnrollError(null);
    setEnrollStatus(null);

    try {
      await enrollCourseMemberMutation(
        {
          courseSlug: course.slug,
          displayName: enrollName,
          email: enrollEmail,
          handle: enrollHandle,
          role: enrollRole
        },
        actor
      );
      setEnrollStatus(`Enrolled ${enrollName} into ${course.title}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setEnrollError(issue instanceof Error ? issue.message : "Manual enrollment failed.");
    } finally {
      setIsEnrolling(false);
    }
  }

  async function handleAttachProblem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAttaching(true);
    setAttachError(null);
    setAttachStatus(null);

    try {
      await attachProblemToCourseMutation(
        {
          courseSlug: course.slug,
          problemSlug
        },
        actor
      );
      setAttachStatus(`Attached ${problemSlug} to ${course.title}.`);
      setProblemSlugsText((current) => {
        const next = [
          ...new Set([
            ...current
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
            problemSlug
          ])
        ];

        return next.join(", ");
      });
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

  async function handlePublishAssessment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPublishingAssessment(true);
    setAssessmentError(null);
    setAssessmentStatus(null);

    try {
      await publishCourseAssessmentMutation(
        {
          closesAt: new Date(closesAt).toISOString(),
          courseSlug: course.slug,
          dueAt: new Date(dueAt).toISOString(),
          opensAt: new Date(opensAt).toISOString(),
          problemSlugs: problemSlugsText
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
          scoreboardMode,
          slug: assessmentSlug,
          summary: assessmentSummary,
          title: assessmentTitle,
          type: assessmentType
        },
        actor
      );
      setAssessmentStatus(`Published ${assessmentTitle}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setAssessmentError(issue instanceof Error ? issue.message : "Assessment publish failed.");
    } finally {
      setIsPublishingAssessment(false);
    }
  }

  const selfJoinChannels = course.joinChannels.filter(
    (
      channel
    ): channel is {
      label: string;
      method: "join_code" | "qr_code";
      token: string;
    } => channel.method !== "manual_invite"
  );

  return (
    <section className={`${shellClassNames.cardStrong} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{tAdmin("courseActions")}</p>
          <h3 className="mt-1 text-2xl font-semibold">
            {tAdmin("courseActionsSubtitle")}
          </h3>
        </div>
        <span className={shellClassNames.badge}>
          {actor.displayName} · {actor.platformRole}
        </span>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className={shellClassNames.eyebrow}>{tAdmin("joinAsActor")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {selfJoinChannels.map((channel) => (
              <button
                className="rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isJoining}
                key={`${channel.method}:${channel.token}`}
                onClick={() => void handleJoin(channel.method, channel.token)}
                type="button"
              >
                {isJoining ? tCommon("joining") : `${channel.label} · ${channel.method}`}
              </button>
            ))}
          </div>
          {joinStatus ? <p className="mt-4 text-sm text-emerald-700">{joinStatus}</p> : null}
          {joinError ? <p className="mt-4 text-sm text-red-700">{joinError}</p> : null}
        </article>

        <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className={shellClassNames.eyebrow}>{tAdmin("manualEnrollment")}</p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => void handleManualEnrollment(event)}
          >
            <input
              className={inputClassName}
              onChange={(event) => setEnrollName(event.target.value)}
              placeholder={tAdmin("displayName")}
              required
              value={enrollName}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className={inputClassName}
                onChange={(event) => setEnrollEmail(event.target.value)}
                placeholder={tAdmin("email")}
                required
                type="email"
                value={enrollEmail}
              />
              <input
                className={inputClassName}
                onChange={(event) => setEnrollHandle(event.target.value)}
                placeholder={tAdmin("handle")}
                required
                value={enrollHandle}
              />
            </div>
            <select
              className={inputClassName}
              onChange={(event) =>
                setEnrollRole(event.target.value as "student" | "ta" | "teacher")
              }
              value={enrollRole}
            >
              <option value="student">student</option>
              <option value="ta">ta</option>
              <option value="teacher">teacher</option>
            </select>
            <button
              className="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isEnrolling}
              type="submit"
            >
              {isEnrolling ? tAdmin("enrolling") : tAdmin("enrollMember")}
            </button>
          </form>
          {enrollStatus ? (
            <p className="mt-4 text-sm text-emerald-700">{enrollStatus}</p>
          ) : null}
          {enrollError ? <p className="mt-4 text-sm text-red-700">{enrollError}</p> : null}
        </article>

        <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className={shellClassNames.eyebrow}>{tAdmin("attachProblem")}</p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => void handleAttachProblem(event)}
          >
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
              {isAttaching ? tAdmin("attaching") : tAdmin("attachButton")}
            </button>
          </form>
          {attachStatus ? (
            <p className="mt-4 text-sm text-emerald-700">{attachStatus}</p>
          ) : null}
          {attachError ? <p className="mt-4 text-sm text-red-700">{attachError}</p> : null}
        </article>

        <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className={shellClassNames.eyebrow}>{tAdmin("publishAssessment")}</p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => void handlePublishAssessment(event)}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className={inputClassName}
                onChange={(event) => setAssessmentTitle(event.target.value)}
                placeholder={tAdmin("assessmentTitle")}
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
              placeholder={tAdmin("assessmentSummary")}
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
              disabled={isPublishingAssessment}
              type="submit"
            >
              {isPublishingAssessment ? tAdmin("publishing") : tAdmin("publishButton")}
            </button>
          </form>
          {assessmentStatus ? (
            <p className="mt-4 text-sm text-emerald-700">{assessmentStatus}</p>
          ) : null}
          {assessmentError ? (
            <p className="mt-4 text-sm text-red-700">{assessmentError}</p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
