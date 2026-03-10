"use client";

import Editor from "@monaco-editor/react";
import { startTransition, useDeferredValue, useState } from "react";

import { useLocale, useTranslations } from "next-intl";

import {
  assessmentContextSchema,
  buildEditorSessionId,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  submissionResultSchema,
  supportedLanguages,
  type Language,
  type SubmissionResult
} from "@nojv/domain";

import type { ProblemDetail } from "@/lib/problem-types";
import { verdictColor } from "@/lib/verdict-colors";

import { TelemetryProbe } from "./telemetry-probe";

const editorOptions = {
  automaticLayout: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 14,
  minimap: {
    enabled: false
  },
  padding: {
    top: 16
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
  onSubmissionComplete?: (
    result: SubmissionResult,
    language: string,
    sourceCode: string
  ) => void;
  problem: ProblemDetail;
}

export function ProblemEditor({
  assessment,
  contestSlug,
  onSubmissionComplete,
  problem
}: ProblemEditorProps) {
  const locale = useLocale();
  const t = useTranslations("editor");
  const editorSessionId = buildEditorSessionId({
    assessmentSlug: assessment?.assessmentSlug,
    contestSlug,
    courseSlug: assessment?.courseSlug,
    problemSlug: problem.slug
  });
  const [language, setLanguage] = useState<Language>("cpp");
  const [drafts, setDrafts] = useState(problem.starterByLanguage);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredSource = useDeferredValue(drafts[language]);

  // Bottom panel state
  const [bottomTab, setBottomTab] = useState<"testcase" | "result">("testcase");
  const [selectedCase, setSelectedCase] = useState(0);
  const [selectedResultCase, setSelectedResultCase] = useState(0);
  const [testcases, setTestcases] = useState(
    problem.samples.map((s) => ({ input: s.input, expectedOutput: s.output }))
  );
  const [runResult, setRunResult] = useState<SubmissionResult | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function executeSubmission(options?: {
    sampleOnly?: boolean;
  }): Promise<SubmissionResult | null> {
    const response = await fetch("/api/submissions", {
      body: JSON.stringify({
        assessment,
        contestSlug,
        language,
        mode: contestSlug ? "contest" : (assessment?.kind ?? "practice"),
        problemSlug: problem.slug,
        sampleOnly: options?.sampleOnly ?? false,
        sourceCode: drafts[language]
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message ?? "Submission failed.");
    }

    const dispatch = submissionDispatchResponseSchema.parse(await response.json());
    const startedAt = Date.now();

    while (Date.now() - startedAt < 20_000) {
      const poll = await fetch(dispatch.pollUrl, { cache: "no-store" });

      if (!poll.ok) {
        const payload = (await poll.json()) as { message?: string };
        throw new Error(payload.message ?? "Polling failed.");
      }

      const operation = submissionOperationSchema.parse(await poll.json());

      if (operation.result) {
        return submissionResultSchema.parse(operation.result);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    }

    throw new Error("Submission polling timed out.");
  }

  async function handleRun() {
    setIsRunning(true);
    setRunResult(null);
    setRunStatus("running");
    setRunError(null);
    setSelectedResultCase(0);
    setBottomTab("result");

    try {
      const result = await executeSubmission({ sampleOnly: true });
      startTransition(() => {
        setRunResult(result);
        setRunStatus(null);
      });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Run failed.");
      setRunStatus(null);
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);

    try {
      const result = await executeSubmission();

      if (result) {
        onSubmissionComplete?.(result, language, drafts[language]);
      }
    } catch (error) {
      // Show submit errors in the run result area as fallback
      setRunError(error instanceof Error ? error.message : "Submission failed.");
      setBottomTab("result");
    } finally {
      setIsSubmitting(false);
    }
  }

  const runVerdictLabel = runResult?.verdict
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="flex h-full flex-col bg-stone-50">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b border-[color:var(--color-border)] bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-stone-500">&lt;/&gt; {t("code")}</span>
          <select
            className="rounded-md border border-stone-200 bg-transparent px-2 py-1 text-xs"
            onChange={(event) => setLanguage(event.target.value as Language)}
            value={language}
          >
            {supportedLanguages.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <span className="text-xs text-stone-400">
            {contestSlug
              ? t("contestMode")
              : assessment
                ? assessment.kind === "exam"
                  ? t("examMode")
                  : t("assignmentMode")
                : t("practiceMode")}
          </span>
        </div>
      </div>

      {/* Monaco editor */}
      <div className="min-h-0 flex-1">
        <Editor
          defaultLanguage="cpp"
          height="100%"
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
      </div>

      {/* Action bar: chars + Run & Submit */}
      <div className="flex items-center justify-between border-t border-[color:var(--color-border)] bg-white px-4 py-2">
        <span className="text-xs text-stone-400">
          {new Intl.NumberFormat(locale).format(deferredSource.length)} {t("chars")}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRunning}
            onClick={() => void handleRun()}
            type="button"
          >
            {isRunning ? t("running") : t("run")}
          </button>
          <button
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? t("submitting") : t("submitButton")}
          </button>
        </div>
      </div>

      {/* Bottom panel: Testcase / Test Result */}
      <div className="flex h-[35%] min-h-[180px] flex-col border-t border-[color:var(--color-border)] bg-white">
        {/* Bottom tabs */}
        <div className="flex items-center border-b border-stone-100 px-2">
          <button
            className={`px-3 py-2 text-xs font-medium transition ${
              bottomTab === "testcase"
                ? "border-b-2 border-stone-700 text-stone-700"
                : "text-stone-400 hover:text-stone-600"
            }`}
            onClick={() => setBottomTab("testcase")}
            type="button"
          >
            {t("testcase")}
          </button>
          <button
            className={`px-3 py-2 text-xs font-medium transition ${
              bottomTab === "result"
                ? "border-b-2 border-stone-700 text-stone-700"
                : "text-stone-400 hover:text-stone-600"
            }`}
            onClick={() => setBottomTab("result")}
            type="button"
          >
            {t("testResult")}
          </button>
        </div>

        {/* Bottom content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {bottomTab === "testcase" ? (
            <div>
              {/* Case tabs + add button */}
              <div className="flex items-center gap-1">
                {testcases.map((_, index) => (
                  <button
                    className={`group relative rounded-md px-3 py-1 text-xs font-medium transition ${
                      selectedCase === index
                        ? "bg-stone-100 text-stone-700"
                        : "text-stone-400 hover:text-stone-600"
                    }`}
                    key={`tab-${String(index)}`}
                    onClick={() => setSelectedCase(index)}
                    type="button"
                  >
                    Case {index + 1}
                    {testcases.length > 1 ? (
                      <span
                        className="ml-1.5 hidden text-stone-300 hover:text-red-400 group-hover:inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTestcases((prev) => prev.filter((_, i) => i !== index));
                          setSelectedCase((prev) => Math.min(prev, testcases.length - 2));
                        }}
                        role="button"
                        tabIndex={-1}
                      >
                        &times;
                      </span>
                    ) : null}
                  </button>
                ))}
                <button
                  className="rounded-md px-2 py-1 text-xs text-stone-300 transition hover:text-stone-500"
                  onClick={() => {
                    setTestcases((prev) => [...prev, { input: "", expectedOutput: "" }]);
                    setSelectedCase(testcases.length);
                  }}
                  type="button"
                >
                  +
                </button>
              </div>

              {/* Input */}
              <div className="mt-3">
                <p className="text-xs text-stone-400">{t("input")}</p>
                <textarea
                  className="mt-1 w-full rounded-md bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700 outline-none focus:ring-1 focus:ring-stone-300"
                  onChange={(event) => {
                    const val = event.target.value;
                    setTestcases((prev) =>
                      prev.map((tc, i) => (i === selectedCase ? { ...tc, input: val } : tc))
                    );
                  }}
                  rows={3}
                  value={testcases[selectedCase]?.input ?? ""}
                />
              </div>

              {/* Expected output */}
              <div className="mt-3">
                <p className="text-xs text-stone-400">{t("expectedOutput")}</p>
                <textarea
                  className="mt-1 w-full rounded-md bg-stone-50 px-3 py-2 font-mono text-sm text-stone-600 outline-none focus:ring-1 focus:ring-stone-300"
                  onChange={(event) => {
                    const val = event.target.value;
                    setTestcases((prev) =>
                      prev.map((tc, i) =>
                        i === selectedCase ? { ...tc, expectedOutput: val } : tc
                      )
                    );
                  }}
                  rows={2}
                  value={testcases[selectedCase]?.expectedOutput ?? ""}
                />
              </div>
            </div>
          ) : (
            <div>
              {runResult ? (
                <div>
                  {/* Verdict + runtime */}
                  <div className="flex items-baseline gap-3">
                    <span
                      className={`text-lg font-semibold ${
                        verdictColor[runResult.verdict] ?? "text-stone-700"
                      }`}
                    >
                      {runVerdictLabel}
                    </span>
                    {runResult.runtimeMs > 0 ? (
                      <span className="text-xs text-stone-400">
                        Runtime: {String(runResult.runtimeMs)} ms
                      </span>
                    ) : null}
                  </div>

                  {/* Per-case tabs */}
                  {runResult.caseResults && runResult.caseResults.length > 0 ? (
                    <>
                      <div className="mt-3 flex items-center gap-1">
                        {runResult.caseResults.map((cr, index) => (
                          <button
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                              selectedResultCase === index
                                ? "bg-stone-100 text-stone-700"
                                : "text-stone-400 hover:text-stone-600"
                            }`}
                            key={`rc-${String(index)}`}
                            onClick={() => setSelectedResultCase(index)}
                            type="button"
                          >
                            <span className={cr.passed ? "text-emerald-500" : "text-red-500"}>
                              {cr.passed ? "\u2714" : "\u2718"}
                            </span>
                            Case {index + 1}
                          </button>
                        ))}
                      </div>

                      {/* Selected case detail */}
                      <div className="mt-3 space-y-3">
                        {/* Input */}
                        {testcases[selectedResultCase] ? (
                          <div>
                            <p className="text-xs font-medium text-stone-400">{t("input")}</p>
                            <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">
                              {testcases[selectedResultCase].input}
                            </pre>
                          </div>
                        ) : null}

                        {/* Output (actual stdout) */}
                        {runResult.caseResults[selectedResultCase] ? (
                          <div>
                            <p className="text-xs font-medium text-stone-400">{t("output")}</p>
                            <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">
                              {runResult.caseResults[selectedResultCase].stdout || "(empty)"}
                            </pre>
                          </div>
                        ) : null}

                        {/* Expected */}
                        {testcases[selectedResultCase]?.expectedOutput ? (
                          <div>
                            <p className="text-xs font-medium text-stone-400">
                              {t("expectedOutput")}
                            </p>
                            <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">
                              {testcases[selectedResultCase].expectedOutput}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : runResult.feedback ? (
                    <p className="mt-2 text-sm leading-6 text-stone-500">
                      {runResult.feedback}
                    </p>
                  ) : null}
                </div>
              ) : runStatus ? (
                <div className="flex items-center gap-2 py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
                  <span className="text-sm text-stone-500">{runStatus}</span>
                </div>
              ) : runError ? (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {runError}
                </div>
              ) : (
                <p className="py-4 text-sm text-stone-400">{t("runFirst")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <TelemetryProbe
        assessment={assessmentContextSchema.optional().parse(assessment)}
        contestSlug={contestSlug}
        sessionId={editorSessionId}
        signalSource="problem_editor"
      />
    </div>
  );
}
