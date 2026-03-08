import { startTransition, useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

import {
  buildActorRequestHeaders,
  buildWorkspaceSessionId,
  localActorPresets,
  workspaceRunDispatchResponseSchema,
  workspaceRunOperationSchema,
  workspaceRunRequestSchema,
  type ActorIdentity
} from "@nojv/domain";
import { getCopy, locales, type LocaleCode } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import {
  buildWorkspaceActorSearch,
  resolveWorkspaceActor,
  workspaceActorStorageKey
} from "./actor-session";
import { resolveWebAppOrigin } from "./runtime-config";

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

const telemetrySignals = [
  "Focus / blur transitions",
  "Paste burst counter",
  "Device fingerprint drift",
  "Command allowlist violations"
] as const;

const initialSource = `#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);

  int a = 0;
  int b = 0;
  cin >> a >> b;
  cout << a + b << "\\n";
}
`;

const initialMakefile = `run:
\t@mkdir -p build
\t@g++ -std=c++20 -O2 src/main.cpp -o build/main
\t@./build/main < tests/sample.in

test: run
`;

interface RunEntry {
  command: string;
  output: string;
  queue: string;
  timestamp: string;
}

function readInitialWorkspaceContext(): {
  assessmentSlug: string;
  contestSlug: string;
  courseSlug: string;
  mode: "assignment" | "contest" | "exam" | "practice";
} {
  if (typeof window === "undefined") {
    return {
      assessmentSlug: "hw1-process-trace",
      contestSlug: "systems-lab-midterm",
      courseSlug: "os-lab-spring-2026",
      mode: "assignment" as const
    };
  }

  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");

  return {
    assessmentSlug: params.get("assessment") ?? "hw1-process-trace",
    contestSlug: params.get("contest") ?? "systems-lab-midterm",
    courseSlug: params.get("course") ?? "os-lab-spring-2026",
    mode:
      requestedMode === "assignment" ||
      requestedMode === "contest" ||
      requestedMode === "exam" ||
      requestedMode === "practice"
        ? requestedMode
        : ("assignment" as const)
  };
}

const workspaceEnv = import.meta.env as ImportMetaEnv & {
  readonly VITE_NOJV_WEB_ORIGIN?: string;
};
const webOrigin = resolveWebAppOrigin(workspaceEnv);
const actorPresetEntries = [
  {
    actor: localActorPresets.teacher,
    key: "teacher",
    label: "Teacher"
  },
  {
    actor: localActorPresets.ta,
    key: "ta",
    label: "TA"
  },
  {
    actor: localActorPresets.student,
    key: "student",
    label: "Student"
  },
  {
    actor: localActorPresets.admin,
    key: "admin",
    label: "Admin"
  }
] as const;

function sameActor(left: ActorIdentity, right: ActorIdentity) {
  return (
    left.userId === right.userId &&
    left.platformRole === right.platformRole &&
    left.handle === right.handle &&
    left.email === right.email &&
    left.displayName === right.displayName
  );
}

function resolveActorPresetKey(actor: ActorIdentity) {
  return actorPresetEntries.find((entry) => sameActor(entry.actor, actor))?.key ?? "student";
}

export function App() {
  const initialContext = readInitialWorkspaceContext();
  const initialActor =
    typeof window === "undefined"
      ? localActorPresets.student
      : resolveWorkspaceActor({
          search: window.location.search,
          storedActor: window.localStorage.getItem(workspaceActorStorageKey)
        });
  const [locale, setLocale] = useState<LocaleCode>("zh-TW");
  const [sandboxMode, setSandboxMode] = useState<
    "assignment" | "contest" | "exam" | "practice"
  >(initialContext.mode);
  const [actor, setActor] = useState<ActorIdentity>(initialActor);
  const [command, setCommand] = useState("make run");
  const [contestSlug, setContestSlug] = useState(initialContext.contestSlug);
  const [courseSlug, setCourseSlug] = useState(initialContext.courseSlug);
  const [assessmentSlug, setAssessmentSlug] = useState(initialContext.assessmentSlug);
  const [sourceCode, setSourceCode] = useState(initialSource);
  const [makefile, setMakefile] = useState(initialMakefile);
  const [sampleInput, setSampleInput] = useState("2 5\n");
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>([
    {
      command: "make run",
      output: "[sandbox] warm start complete\n[sandbox] ready for queue-backed execution",
      queue: "workspace-run",
      timestamp: "14:10"
    }
  ]);

  const copy = getCopy(locale);
  const workspaceSessionId = buildWorkspaceSessionId({
    assessmentSlug:
      sandboxMode === "assignment" || sandboxMode === "exam" ? assessmentSlug : undefined,
    contestSlug: sandboxMode === "contest" ? contestSlug : undefined,
    courseSlug: sandboxMode === "assignment" || sandboxMode === "exam" ? courseSlug : undefined,
    mode: sandboxMode
  });

  useEffect(() => {
    window.localStorage.setItem(workspaceActorStorageKey, JSON.stringify(actor));
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${buildWorkspaceActorSearch(window.location.search, actor)}`
    );
  }, [actor]);

  async function pollWorkspaceRun(pollUrl: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 20_000) {
      const response = await fetch(`${webOrigin}${pollUrl}`, {
        cache: "no-store",
        headers: buildActorRequestHeaders(actor)
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "Workspace polling failed.");
      }

      const payload = workspaceRunOperationSchema.parse(await response.json());

      if (payload.result) {
        return payload.result;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    }

    throw new Error("Workspace polling timed out.");
  }

  async function handleRun() {
    const validatedRequest = (() => {
      try {
        return workspaceRunRequestSchema.parse({
          assessment:
            sandboxMode === "assignment" || sandboxMode === "exam"
              ? {
                  assessmentSlug,
                  courseSlug,
                  kind: sandboxMode
                }
              : undefined,
          command,
          contestSlug: sandboxMode === "contest" ? contestSlug : undefined,
          files: [
            {
              content: makefile,
              path: "Makefile"
            },
            {
              content: sourceCode,
              path: "src/main.cpp"
            },
            {
              content: sampleInput,
              path: "tests/sample.in"
            }
          ],
          mode: sandboxMode,
          workspaceSessionId
        });
      } catch (issue) {
        const message = issue instanceof Error ? issue.message : "Unknown validation error";
        setError(message);
        return null;
      }
    })();

    if (!validatedRequest) {
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch(`${webOrigin}/api/workspace/runs`, {
        body: JSON.stringify(validatedRequest),
        headers: {
          ...buildActorRequestHeaders(actor),
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "Workspace execution failed.");
      }

      const dispatch = workspaceRunDispatchResponseSchema.parse(await response.json());
      const payload = await pollWorkspaceRun(dispatch.pollUrl);

      startTransition(() => {
        setRuns((current) => [
          {
            command: validatedRequest.command,
            output: `[status] ${payload.status}\n[stdout]\n${payload.stdout || "(empty)"}\n\n[stderr]\n${payload.stderr || "(empty)"}`,
            queue: "workspace-run",
            timestamp: new Date().toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit"
            })
          },
          ...current
        ]);
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Workspace execution failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 sm:px-6">
      <header className="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-4 backdrop-blur-sm sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={shellClassNames.eyebrow}>NOJV Workspace</p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl">
              {copy.workspace.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--color-muted)]">
              {copy.workspace.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-white/60 p-1 text-sm">
              {locales.map((entry) => (
                <button
                  className={`rounded-full px-3 py-1.5 ${entry === locale ? "bg-[color:var(--color-accent)] text-white" : ""}`}
                  key={entry}
                  onClick={() => setLocale(entry)}
                  type="button"
                >
                  {entry}
                </button>
              ))}
            </div>
            <label className="rounded-full border border-[color:var(--color-border)] bg-white/60 px-3 py-2 text-sm text-[color:var(--color-ink)]">
              <span className="mr-2 text-[color:var(--color-muted)]">Actor</span>
              <select
                className="bg-transparent"
                onChange={(event) => {
                  const preset = actorPresetEntries.find(
                    (entry) => entry.key === event.target.value
                  );

                  if (preset) {
                    setActor(preset.actor);
                  }
                }}
                value={resolveActorPresetKey(actor)}
              >
                {actorPresetEntries.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} · {entry.actor.displayName}
                  </option>
                ))}
              </select>
            </label>
            <span className={shellClassNames.badge}>Monaco editor</span>
            <span className={shellClassNames.badge}>BullMQ-backed execution</span>
          </div>
        </div>
      </header>

      <main className="grid flex-1 gap-6 py-6 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="space-y-6">
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>File Tree</p>
            <div className="mt-4 space-y-2">
              {["src/main.cpp", "Makefile", "tests/sample.in"].map((file) => (
                <div
                  className="rounded-2xl border border-[color:var(--color-border)] bg-white/60 px-3 py-3 text-sm"
                  key={file}
                >
                  {file}
                </div>
              ))}
            </div>
          </section>

          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>{copy.workspace.policyLabel}</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
              <p>Assignment mode allows make plus course scripts inside a per-run workspace.</p>
              <p>
                Contest mode narrows the command allowlist and surfaces violations immediately.
              </p>
            </div>
          </section>

          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Telemetry</p>
            <div className="mt-4 space-y-2 text-sm text-[color:var(--color-muted)]">
              {telemetrySignals.map((signal) => (
                <div
                  className="rounded-2xl border border-[color:var(--color-border)] bg-white/60 px-3 py-3"
                  key={signal}
                >
                  {signal}
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <div className={`${shellClassNames.cardStrong} px-6 py-6`}>
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className={shellClassNames.eyebrow}>Workspace execution</p>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
                  Queue-backed command runs inside isolated workspaces.
                </h2>
                <p className="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
                  This Vite surface owns interactive coding and command dispatch. Every run
                  ships files plus command metadata to the Next.js API, then the worker
                  materializes them in a per-run temp directory before executing.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`${shellClassNames.card} px-4 py-4`}>
                  <p className={shellClassNames.eyebrow}>Language</p>
                  <p className="mt-2 text-lg font-semibold">C++ / Makefile</p>
                </div>
                <div className={`${shellClassNames.card} px-4 py-4`}>
                  <p className={shellClassNames.eyebrow}>Run session</p>
                  <p className="mt-2 text-lg font-semibold">{workspaceSessionId}</p>
                </div>
              </div>
            </div>
          </div>

          <section className={`${shellClassNames.card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-5 py-4">
              <div>
                <p className={shellClassNames.eyebrow}>Editor</p>
                <p className="mt-1 text-lg font-semibold">Inline source editing</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={shellClassNames.badge}>src/main.cpp</span>
                <span className={shellClassNames.badge}>make run</span>
              </div>
            </div>
            <Editor
              defaultLanguage="cpp"
              height="540px"
              onChange={(value) => setSourceCode(value ?? "")}
              options={editorOptions}
              theme="vs-light"
              value={sourceCode}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Makefile</p>
              <textarea
                className="mt-4 h-48 w-full rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 font-mono text-sm"
                onChange={(event) => setMakefile(event.target.value)}
                value={makefile}
              />
            </div>
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Sample input</p>
              <textarea
                className="mt-4 h-48 w-full rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 font-mono text-sm"
                onChange={(event) => setSampleInput(event.target.value)}
                value={sampleInput}
              />
            </div>
          </section>
        </section>

        <aside className="space-y-6">
          <section className={`${shellClassNames.cardStrong} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>{copy.workspace.commandLabel}</p>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="mb-2 block text-[color:var(--color-muted)]">
                  Isolation mode
                </span>
                <select
                  className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
                  onChange={(event) =>
                    setSandboxMode(
                      event.target.value as "assignment" | "contest" | "exam" | "practice"
                    )
                  }
                  value={sandboxMode}
                >
                  <option value="assignment">assignment</option>
                  <option value="exam">exam</option>
                  <option value="practice">practice</option>
                  <option value="contest">contest</option>
                </select>
              </label>

              {sandboxMode === "assignment" || sandboxMode === "exam" ? (
                <>
                  <label className="block text-sm">
                    <span className="mb-2 block text-[color:var(--color-muted)]">
                      Course slug
                    </span>
                    <input
                      className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
                      onChange={(event) => setCourseSlug(event.target.value)}
                      value={courseSlug}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-2 block text-[color:var(--color-muted)]">
                      Assessment slug
                    </span>
                    <input
                      className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
                      onChange={(event) => setAssessmentSlug(event.target.value)}
                      value={assessmentSlug}
                    />
                  </label>
                </>
              ) : null}

              {sandboxMode === "contest" ? (
                <label className="block text-sm">
                  <span className="mb-2 block text-[color:var(--color-muted)]">
                    Contest slug
                  </span>
                  <input
                    className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
                    onChange={(event) => setContestSlug(event.target.value)}
                    value={contestSlug}
                  />
                </label>
              ) : null}

              <label className="block text-sm">
                <span className="mb-2 block text-[color:var(--color-muted)]">Command</span>
                <input
                  className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-3 py-3"
                  onChange={(event) => setCommand(event.target.value)}
                  value={command}
                />
              </label>

              <button
                className="w-full rounded-full bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isRunning}
                onClick={() => void handleRun()}
                type="button"
              >
                {isRunning ? "Running..." : copy.workspace.runLabel}
              </button>

              {error ? (
                <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>
          </section>

          <section className={`${shellClassNames.card} px-5 py-5`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={shellClassNames.eyebrow}>Terminal</p>
                <p className="mt-1 text-lg font-semibold">Run history</p>
              </div>
              <span className={shellClassNames.badge}>{runs.length} runs</span>
            </div>
            <div className="mt-4 space-y-3">
              {runs.map((run) => (
                <article
                  className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[#221d1b] px-4 py-4 text-sm text-stone-100"
                  key={`${run.timestamp}-${run.command}`}
                >
                  <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.18em] text-stone-400">
                    <span>{run.queue}</span>
                    <span>{run.timestamp}</span>
                  </div>
                  <p className="mt-3 font-semibold text-stone-100">{run.command}</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-stone-300">
                    {run.output}
                  </pre>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
