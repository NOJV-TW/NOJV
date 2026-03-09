"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

interface RuntimeStatsPayload {
  cheatingCases: number;
  cheatingSignals: number;
  submissions: number;
  workspaceRuns: number;
}

export function RuntimeStats() {
  const t = useTranslations("runtimeStats");
  const [stats, setStats] = useState<RuntimeStatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/runtime/stats", {
          signal: controller.signal
        });

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? "Runtime stats request failed.");
        }

        const payload = (await response.json()) as RuntimeStatsPayload;
        setStats(payload);
      } catch (issue) {
        if (issue instanceof DOMException && issue.name === "AbortError") {
          return;
        }

        setError(issue instanceof Error ? issue.message : "Runtime stats request failed.");
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{t("heading")}</p>
          <p className="mt-1 text-lg font-semibold">{t("subtitle")}</p>
        </div>
        <span className={shellClassNames.badge}>Prisma</span>
      </div>
      {error ? (
        <p className="mt-4 text-sm leading-7 text-red-700">{error}</p>
      ) : stats ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
            <p className="text-sm text-[color:var(--color-muted)]">{t("submissions")}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {stats.submissions}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
            <p className="text-sm text-[color:var(--color-muted)]">{t("workspaceRuns")}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {stats.workspaceRuns}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
            <p className="text-sm text-[color:var(--color-muted)]">{t("integritySignals")}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {stats.cheatingSignals}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
            <p className="text-sm text-[color:var(--color-muted)]">{t("openCases")}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {stats.cheatingCases}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
          {t("loading")}
        </p>
      )}
    </section>
  );
}
