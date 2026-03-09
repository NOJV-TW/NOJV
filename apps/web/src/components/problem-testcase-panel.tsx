"use client";

import { useState, type SyntheticEvent } from "react";

import { useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { createProblemTestcaseSetMutation } from "@/lib/client/course-management-client";

import { useActorSession } from "./actor-session-provider";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
const textareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;

interface ProblemTestcasePanelProps {
  problemSlug: string;
}

interface DraftCase {
  expectedStdout: string;
  stdin: string;
}

export function ProblemTestcasePanel({ problemSlug }: ProblemTestcasePanelProps) {
  const { actor } = useActorSession();
  const t = useTranslations("testcases");
  const [name, setName] = useState("Samples");
  const [isHidden, setIsHidden] = useState(false);
  const [weight, setWeight] = useState(1);
  const [cases, setCases] = useState<DraftCase[]>([
    {
      expectedStdout: "3\n",
      stdin: "1 2\n"
    }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      await createProblemTestcaseSetMutation(
        problemSlug,
        {
          cases,
          isHidden,
          name,
          weight
        },
        actor
      );
      setMessage(`Created testcase set ${name} with ${String(cases.length)} case(s).`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Testcase set creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{t("authorTestcases")}</p>
          <p className="mt-1 text-lg font-semibold">{t("authorTestcasesSubtitle")}</p>
        </div>
        <span className={shellClassNames.badge}>{actor.platformRole}</span>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 md:grid-cols-[1fr_120px_140px]">
          <label className="text-sm text-[color:var(--color-muted)]">
            {t("setName")}
            <input
              className={inputClassName}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="text-sm text-[color:var(--color-muted)]">
            {t("weight")}
            <input
              className={inputClassName}
              min={1}
              onChange={(event) => setWeight(Number(event.target.value))}
              required
              type="number"
              value={weight}
            />
          </label>
          <label className="flex items-end gap-3 text-sm text-[color:var(--color-muted)]">
            <input
              checked={isHidden}
              onChange={(event) => setIsHidden(event.target.checked)}
              type="checkbox"
            />
            {t("hiddenSet")}
          </label>
        </div>
        <div className="grid gap-4">
          {cases.map((testcase, index) => (
            <article
              className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
              key={`case-${String(index)}`}
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold">{t("case")} {index + 1}</p>
                {cases.length > 1 ? (
                  <button
                    className="text-sm text-red-700"
                    onClick={() => {
                      setCases((current) =>
                        current.filter((_, entryIndex) => entryIndex !== index)
                      );
                    }}
                    type="button"
                  >
                    {t("remove")}
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <label className="text-sm text-[color:var(--color-muted)]">
                  {t("stdin")}
                  <textarea
                    className={textareaClassName}
                    onChange={(event) => {
                      setCases((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, stdin: event.target.value } : entry
                        )
                      );
                    }}
                    required
                    value={testcase.stdin}
                  />
                </label>
                <label className="text-sm text-[color:var(--color-muted)]">
                  {t("expectedStdout")}
                  <textarea
                    className={textareaClassName}
                    onChange={(event) => {
                      setCases((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, expectedStdout: event.target.value }
                            : entry
                        )
                      );
                    }}
                    required
                    value={testcase.expectedStdout}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white"
            onClick={() => {
              setCases((current) => [
                ...current,
                {
                  expectedStdout: "",
                  stdin: ""
                }
              ]);
            }}
            type="button"
          >
            {t("addCase")}
          </button>
          <button
            className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? t("saving") : t("createButton")}
          </button>
        </div>
        {message ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </form>
    </section>
  );
}
