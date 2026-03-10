"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { SubmissionResult } from "@nojv/domain";

import type { ProblemDetail } from "@/lib/problem-types";
import { verdictColor } from "@/lib/verdict-colors";

import { MarkdownLatex } from "./markdown-latex";
import { ProblemEditor } from "./problem-editor";

const difficultyColor: Record<string, string> = {
  easy: "bg-emerald-500/15 text-emerald-700",
  hard: "bg-red-500/15 text-red-700",
  medium: "bg-amber-500/15 text-amber-700"
};

interface SubmissionEntry {
  language: string;
  result: SubmissionResult;
  sourceCode: string;
  submittedAt: string;
}

interface ProblemWorkspaceProps {
  assessment?:
    | {
        assessmentSlug: string;
        courseSlug: string;
        kind: "assignment" | "exam";
      }
    | undefined;
  backLink?: { href: string; label: string } | undefined;
  contestSlug?: string | undefined;
  problem: ProblemDetail;
}

export function ProblemWorkspace({
  assessment,
  backLink,
  contestSlug,
  problem
}: ProblemWorkspaceProps) {
  const tProblem = useTranslations("problemDetail");
  const tEditor = useTranslations("editor");
  const [leftTab, setLeftTab] = useState<"description" | "submissions">("description");
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  function handleSubmissionComplete(
    result: SubmissionResult,
    language: string,
    sourceCode: string
  ) {
    setSubmissions((previous) => [
      {
        language,
        result,
        sourceCode,
        submittedAt: new Date().toISOString()
      },
      ...previous
    ]);
    setLeftTab("submissions");
    setViewingIndex(0);
  }

  return (
    <>
      {/* Left panel */}
      <div className="flex w-full shrink-0 flex-col overflow-hidden bg-white lg:w-[42%] lg:border-r lg:border-[color:var(--color-border)]">
        {/* Tab bar */}
        <div className="flex items-center border-b border-[color:var(--color-border)] px-2">
          {backLink ? (
            <a
              className="px-3 py-2.5 text-xs text-stone-400 transition hover:text-stone-600"
              href={backLink.href}
            >
              &larr; {backLink.label}
            </a>
          ) : null}
          <button
            className={`px-3 py-2.5 text-xs font-medium transition ${
              leftTab === "description"
                ? "border-b-2 border-[color:var(--color-accent)] text-[color:var(--color-ink)]"
                : "text-stone-400 hover:text-stone-600"
            }`}
            onClick={() => setLeftTab("description")}
            type="button"
          >
            {tProblem("description")}
          </button>
          <button
            className={`px-3 py-2.5 text-xs font-medium transition ${
              leftTab === "submissions"
                ? "border-b-2 border-[color:var(--color-accent)] text-[color:var(--color-ink)]"
                : "text-stone-400 hover:text-stone-600"
            }`}
            onClick={() => setLeftTab("submissions")}
            type="button"
          >
            {tProblem("submissions")}
            {submissions.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] tabular-nums">
                {submissions.length}
              </span>
            ) : null}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {leftTab === "description" ? (
            <div className="p-5">
              <h1 className="text-lg font-semibold leading-snug">{problem.title}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                    difficultyColor[problem.difficulty] ?? "bg-stone-100 text-stone-600"
                  }`}
                >
                  {problem.difficulty}
                </span>
                {problem.tags.map((tag) => (
                  <span
                    className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-500"
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-5 text-sm leading-7 text-stone-700">
                <MarkdownLatex>{problem.statement}</MarkdownLatex>
              </div>

              {problem.inputFormat ? (
                <div className="mt-5">
                  <p className="text-sm font-semibold">{tProblem("inputFormat")}:</p>
                  <div className="mt-1 text-sm leading-7 text-stone-600">
                    <MarkdownLatex>{problem.inputFormat}</MarkdownLatex>
                  </div>
                </div>
              ) : null}

              {problem.outputFormat ? (
                <div className="mt-4">
                  <p className="text-sm font-semibold">{tProblem("outputFormat")}:</p>
                  <div className="mt-1 text-sm leading-7 text-stone-600">
                    <MarkdownLatex>{problem.outputFormat}</MarkdownLatex>
                  </div>
                </div>
              ) : null}

              {problem.samples.map((sample, index) => (
                <div className="mt-6" key={`sample-${String(index)}`}>
                  <p className="text-sm font-semibold">
                    {tProblem("sample")} {index + 1}:
                  </p>
                  <div className="mt-2 rounded-lg bg-stone-50 px-4 py-3 text-sm leading-7">
                    <p>
                      <span className="font-semibold">{tProblem("input")}:</span>{" "}
                      <code className="font-mono text-stone-600">{sample.input}</code>
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">{tProblem("output")}:</span>{" "}
                      <code className="font-mono text-stone-600">{sample.output}</code>
                    </p>
                    {sample.explanation ? (
                      <>
                        <p className="mt-2 font-semibold">{tProblem("explanation")}:</p>
                        <p className="mt-1 text-stone-600">{sample.explanation}</p>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5">
              {submissions.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-400">
                  {tProblem("noSubmissions")}
                </p>
              ) : viewingIndex !== null && submissions[viewingIndex] ? (
                /* ── Submission detail view ── */
                (() => {
                  const entry = submissions[viewingIndex];
                  const label = entry.result.verdict
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (char) => char.toUpperCase());

                  return (
                    <div>
                      {/* Back button */}
                      <button
                        className="mb-4 text-xs text-stone-400 transition hover:text-stone-600"
                        onClick={() => setViewingIndex(null)}
                        type="button"
                      >
                        &larr; {tProblem("allSubmissions")}
                      </button>

                      {/* Verdict header */}
                      <div className="flex items-baseline gap-3">
                        <span
                          className={`text-lg font-semibold ${
                            verdictColor[entry.result.verdict] ?? "text-stone-700"
                          }`}
                        >
                          {label}
                        </span>
                        {entry.result.runtimeMs > 0 ? (
                          <span className="text-xs text-stone-400">
                            Runtime: {String(entry.result.runtimeMs)} ms
                          </span>
                        ) : null}
                      </div>

                      {/* Meta row */}
                      <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                        <span>{entry.language}</span>
                        <span>{String(entry.result.score)}/100</span>
                        <span>{new Date(entry.submittedAt).toLocaleTimeString()}</span>
                      </div>

                      {/* Per-case results */}
                      {entry.result.caseResults && entry.result.caseResults.length > 0 ? (
                        <div className="mt-4 flex flex-wrap items-center gap-1">
                          {entry.result.caseResults.map((cr, i) => (
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                                cr.passed
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-red-50 text-red-600"
                              }`}
                              key={`cr-${String(i)}`}
                            >
                              {cr.passed ? "\u2714" : "\u2718"} Case {i + 1}
                            </span>
                          ))}
                        </div>
                      ) : entry.result.feedback ? (
                        <p className="mt-3 text-sm leading-6 text-stone-500">
                          {entry.result.feedback}
                        </p>
                      ) : null}

                      {/* Source code */}
                      <div className="mt-5">
                        <p className="text-xs font-medium text-stone-400">{tEditor("code")}</p>
                        <pre className="mt-2 max-h-[50vh] overflow-auto rounded-lg bg-stone-50 px-4 py-3 font-mono text-xs leading-5 text-stone-700">
                          {entry.sourceCode}
                        </pre>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* ── Submission list view ── */
                <div className="grid gap-3">
                  {submissions.map((entry, index) => {
                    const label = entry.result.verdict
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (char) => char.toUpperCase());

                    return (
                      <button
                        className="rounded-lg border border-stone-200 px-4 py-3 text-left transition hover:border-stone-300 hover:bg-stone-50"
                        key={`sub-${String(index)}`}
                        onClick={() => setViewingIndex(index)}
                        type="button"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span
                            className={`text-sm font-semibold ${
                              verdictColor[entry.result.verdict] ?? "text-stone-700"
                            }`}
                          >
                            {label}
                          </span>
                          <span className="text-xs text-stone-400">
                            {new Date(entry.submittedAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                          <span>{entry.language}</span>
                          {entry.result.runtimeMs > 0 ? (
                            <span>{String(entry.result.runtimeMs)} ms</span>
                          ) : null}
                          <span>{String(entry.result.score)}/100</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel (desktop only) */}
      <div className="hidden flex-1 flex-col overflow-hidden lg:flex">
        <ProblemEditor
          assessment={assessment}
          contestSlug={contestSlug}
          onSubmissionComplete={handleSubmissionComplete}
          problem={problem}
        />
      </div>
    </>
  );
}
