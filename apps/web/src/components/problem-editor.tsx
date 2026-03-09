"use client";

import Link from "next/link";
import Editor from "@monaco-editor/react";
import { startTransition, useDeferredValue, useState } from "react";

import {
  assessmentContextSchema,
  buildEditorSessionId,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  submissionResultSchema,
  supportedLanguages,
  type Language,
  type LocaleCode,
  type SubmissionResult
} from "@nojv/domain";
import { shellClassNames } from "@nojv/ui";

import type { ProblemDetail } from "@/lib/problem-types";
import { buildWorkspaceLaunchUrl, resolveWorkspaceAppUrl } from "@/lib/workspace-launch";

import { useActorSession } from "./actor-session-provider";
import { TelemetryProbe } from "./telemetry-probe";

const editorOptions = {
  automaticLayout: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 14,
  minimap: {
    enabled: false
  },
  padding: {
    top: 18
  },
  scrollBeyondLastLine: false,
  wordWrap: "on" as const
};

interface ProblemEditorProps {
  assessment?:
    | {
        assessmentSlug: string;
        courseSlug: string;
        kind: "assignment" | "exam";
      }
    | undefined;
  contestSlug?: string | undefined;
  locale: LocaleCode;
  problem: ProblemDetail;
}

export function ProblemEditor({
  assessment,
  contestSlug,
  locale,
  problem
}: ProblemEditorProps) {
  const { actor, actorHeaders } = useActorSession();
  const editorSessionId = buildEditorSessionId({
    assessmentSlug: assessment?.assessmentSlug,
    contestSlug,
    courseSlug: assessment?.courseSlug,
    problemSlug: problem.slug
  });
  const workspaceLabUrl = buildWorkspaceLaunchUrl(resolveWorkspaceAppUrl(), {
    assessment,
    actor,
    contestSlug
  });
  const [language, setLanguage] = useState<Language>("cpp");
  const [drafts, setDrafts] = useState(problem.starterByLanguage);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const deferredSource = useDeferredValue(drafts[language]);

  async function pollSubmission(pollUrl: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 20_000) {
      const response = await fetch(pollUrl, {
        cache: "no-store"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "Submission polling failed.");
      }

      const payload = submissionOperationSchema.parse(await response.json());

      startTransition(() => {
        setSubmission(payload.result ? submissionResultSchema.parse(payload.result) : null);
        setSubmissionStatus(payload.status);
      });

      if (payload.result) {
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    }

    throw new Error("Submission polling timed out.");
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmissionError(null);
    setSubmission(null);
    setSubmissionStatus("queued");

    try {
      const response = await fetch("/api/submissions", {
        body: JSON.stringify({
          assessment,
          contestSlug,
          language,
          mode: contestSlug ? "contest" : (assessment?.kind ?? "practice"),
          problemSlug: problem.slug,
          sourceCode: drafts[language]
        }),
        headers: {
          ...actorHeaders,
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "Submission failed.");
      }

      const payload = submissionDispatchResponseSchema.parse(await response.json());
      startTransition(() => {
        setSubmissionStatus(payload.status);
      });
      await pollSubmission(payload.pollUrl);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className={`${shellClassNames.card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--color-border)] px-5 py-4">
          <div>
            <p className={shellClassNames.eyebrow}>Online editor</p>
            <p className="mt-1 text-lg font-semibold">
              LeetCode-style editing without file uploads
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={shellClassNames.badge}>
              {contestSlug
                ? "contest mode"
                : assessment
                  ? `${assessment.kind} mode`
                  : "practice mode"}
            </span>
            <span className={shellClassNames.badge}>
              {new Intl.NumberFormat(locale).format(deferredSource.length)} chars
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--color-border)] px-5 py-4">
          <label className="text-sm">
            <span className="mb-2 block text-[color:var(--color-muted)]">Language</span>
            <select
              className="rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
              onChange={(event) => setLanguage(event.target.value as Language)}
              value={language}
            >
              {supportedLanguages.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? "Submitting..." : "Submit to sandbox judge"}
          </button>
          <Link
            className="rounded-full border border-[color:var(--color-border)] px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
            href={workspaceLabUrl}
            target="_blank"
          >
            Open workspace lab
          </Link>
        </div>
        <Editor
          defaultLanguage="cpp"
          height="560px"
          onChange={(value) => {
            setDrafts((current) => ({
              ...current,
              [language]: value ?? ""
            }));
          }}
          options={editorOptions}
          theme="vs-light"
          value={drafts[language]}
        />
      </section>

      <aside className="space-y-6">
        <section className={`${shellClassNames.cardStrong} px-5 py-5`}>
          <p className={shellClassNames.eyebrow}>Submission verdict</p>
          <p className="mt-1 text-lg font-semibold">Sandbox testcase judge</p>
          {submission ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
                <p className="text-sm text-[color:var(--color-muted)]">Verdict</p>
                <p className="mt-2 text-3xl font-[family-name:var(--font-display)]">
                  {submission.verdict}
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
                <p className="text-sm text-[color:var(--color-muted)]">Judge feedback</p>
                <p className="mt-2 text-sm leading-7 text-[color:var(--color-muted)]">
                  {submission.feedback}
                </p>
              </div>
            </div>
          ) : submissionStatus ? (
            <div className="mt-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
              <p className="text-sm text-[color:var(--color-muted)]">Queue state</p>
              <p className="mt-2 text-3xl font-[family-name:var(--font-display)]">
                {submissionStatus}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
              Submit a solution to exercise the full judge path from editor to worker verdict.
            </p>
          )}
          {submissionError ? (
            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submissionError}
            </div>
          ) : null}
        </section>

        <section className={`${shellClassNames.card} px-5 py-5`}>
          <p className={shellClassNames.eyebrow}>Execution guarantees</p>
          <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
            <p>Inline editor runs inside the web app without manual uploads.</p>
            <p>Submissions hit BullMQ and execute against persisted testcase sets.</p>
            <p>Heavy command execution stays inside the separate workspace surface.</p>
          </div>
        </section>

        <TelemetryProbe
          assessment={assessmentContextSchema.optional().parse(assessment)}
          contestSlug={contestSlug}
          sessionId={editorSessionId}
          signalSource="problem_editor"
        />
      </aside>
    </div>
  );
}
