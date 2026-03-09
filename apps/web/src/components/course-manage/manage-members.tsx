"use client";

import { startTransition, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { shellClassNames } from "@nojv/ui";

import { enrollCourseMemberMutation } from "@/lib/client/course-management-client";
import type { CoursePocMember } from "@/lib/server/read-model";

interface ManageMembersProps {
  courseSlug: string;
  courseTitle: string;
  members: CoursePocMember[];
}

export function ManageMembers({ courseSlug, courseTitle, members }: ManageMembersProps) {
  const router = useRouter();
  const [enrollName, setEnrollName] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollHandle, setEnrollHandle] = useState("");
  const [enrollRole, setEnrollRole] = useState<"student" | "ta" | "teacher">("student");
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";

  async function handleManualEnrollment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsEnrolling(true);
    setEnrollError(null);
    setEnrollStatus(null);

    try {
      await enrollCourseMemberMutation({
        courseSlug,
        displayName: enrollName,
        email: enrollEmail,
        handle: enrollHandle,
        role: enrollRole
      });
      setEnrollStatus(`Enrolled ${enrollName} into ${courseTitle}.`);
      setEnrollName("");
      setEnrollEmail("");
      setEnrollHandle("");
      startTransition(() => {
        router.refresh();
      });
    } catch (issue) {
      setEnrollError(issue instanceof Error ? issue.message : "Manual enrollment failed.");
    } finally {
      setIsEnrolling(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.card} px-5 py-5`}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold">Members</h3>
          <span className={shellClassNames.badge}>{members.length}</span>
        </div>
        <div className="mt-5 space-y-3">
          {members.map((member) => (
            <article
              className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={member.userId}
            >
              <div>
                <p className="text-lg font-semibold">{member.displayName}</p>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                  {member.handle} · {member.email}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {member.courseRole}
                </p>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                  via {member.joinedVia.replaceAll("_", " ")}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${shellClassNames.card} px-5 py-5`}>
        <h3 className="text-2xl font-semibold">Enroll Member</h3>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => void handleManualEnrollment(event)}
        >
          <input
            className={inputClassName}
            onChange={(event) => setEnrollName(event.target.value)}
            placeholder="Display name"
            required
            value={enrollName}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className={inputClassName}
              onChange={(event) => setEnrollEmail(event.target.value)}
              placeholder="Email"
              required
              type="email"
              value={enrollEmail}
            />
            <input
              className={inputClassName}
              onChange={(event) => setEnrollHandle(event.target.value)}
              placeholder="Handle"
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
            {isEnrolling ? "Enrolling..." : "Enroll Member"}
          </button>
        </form>
        {enrollStatus ? <p className="mt-4 text-sm text-emerald-700">{enrollStatus}</p> : null}
        {enrollError ? <p className="mt-4 text-sm text-red-700">{enrollError}</p> : null}
      </section>
    </div>
  );
}
