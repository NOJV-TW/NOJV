"use client";

import {
  startTransition,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent
} from "react";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";

import type { JudgeType } from "@nojv/domain";
import { CircleHelp } from "lucide-react";

import {
  createProblemMutation,
  createProblemTestcaseSetMutation
} from "@/lib/client/course-management-client";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
const textareaClassName = `${inputClassName} min-h-28 resize-y`;
const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;
const smallInputClassName =
  "w-full rounded-xl border border-[color:var(--color-border)] bg-white/80 px-2 py-1.5 text-xs font-mono";
const pillButton =
  "inline-flex rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white";

// --- Types ---

interface ExampleCase {
  stdin: string;
  expectedStdout: string;
}

interface ParsedCase {
  stdin: string;
  expectedStdout: string;
  sourceFile: string;
}

interface SubtaskConfig {
  name: string;
  description: string;
  points: number;
  caseIndices: number[];
}

// --- Templates ---

const CHECKER_TEMPLATE = `import sys

input_data = open(sys.argv[1]).read()
expected = open(sys.argv[2]).read()
actual = open(sys.argv[3]).read()

if actual.strip() == expected.strip():
    print("AC")
    sys.exit(0)
else:
    print("WA")
    sys.exit(1)
`;

const INTERACTOR_TEMPLATE = `import sys

# Read from stdin (contestant output), write to stdout (contestant input)
t = int(input())
print(t)
sys.stdout.flush()
`;

// --- Helpers ---

/**
 * Parse ZIP files using a regex with two capture groups:
 *   Group 1 = subtask ID, Group 2 = case ID
 * Example patterns:
 *   (\d+)-(\d+)  matches "1-01.in" → subtask 1, case 01
 *   (\d{2})(\d{2}) matches "0103.in" → subtask 01, case 03
 */
function detectSubtasksFromFiles(
  files: { name: string; content: string }[],
  regexPattern: string,
  inExt: string,
  outExt: string
): { cases: ParsedCase[]; subtasks: SubtaskConfig[]; error?: string } {
  let regex: RegExp;
  try {
    regex = new RegExp(`^${regexPattern}$`);
  } catch {
    return { cases: [], subtasks: [], error: "Invalid regex pattern" };
  }

  // Group files by: stem → { in content, out content }
  // stem = filename without extension
  const bySubtask = new Map<
    string,
    Map<string, { in?: string; out?: string; fileName: string }>
  >();

  for (const file of files) {
    const baseName = file.name.includes("/")
      ? (file.name.split("/").pop() ?? file.name)
      : file.name;
    const isIn = baseName.endsWith(inExt);
    const isOut = baseName.endsWith(outExt);
    if (!isIn && !isOut) continue;

    const ext = isIn ? inExt : outExt;
    const stem = baseName.slice(0, -ext.length);
    const match = regex.exec(stem);
    if (!match?.[1] || !match[2]) continue;

    const subtaskId = match[1];
    const caseId = match[2];

    if (!bySubtask.has(subtaskId)) {
      bySubtask.set(subtaskId, new Map());
    }
    const cases = bySubtask.get(subtaskId);
    if (!cases) continue;
    if (!cases.has(caseId)) {
      cases.set(caseId, { fileName: stem });
    }
    const entry = cases.get(caseId);
    if (!entry) continue;
    if (isIn) entry.in = file.content;
    if (isOut) entry.out = file.content;
  }

  if (bySubtask.size === 0) {
    return { cases: [], subtasks: [], error: "No files matched the pattern" };
  }

  const allCases: ParsedCase[] = [];
  const subtasks: SubtaskConfig[] = [];
  const sortedSubtaskIds = [...bySubtask.keys()].sort((a, b) => Number(a) - Number(b));

  for (const subtaskId of sortedSubtaskIds) {
    const casesMap = bySubtask.get(subtaskId);
    if (!casesMap) continue;
    const sortedCaseIds = [...casesMap.keys()].sort((a, b) => Number(a) - Number(b));
    const indices: number[] = [];

    for (const caseId of sortedCaseIds) {
      const entry = casesMap.get(caseId);
      if (!entry) continue;
      indices.push(allCases.length);
      allCases.push({
        stdin: entry.in ?? "",
        expectedStdout: entry.out ?? "",
        sourceFile: `${entry.fileName}${inExt}`
      });
    }

    subtasks.push({
      name: `Subtask ${subtaskId}`,
      description: "",
      points: Math.round(100 / sortedSubtaskIds.length),
      caseIndices: indices
    });
  }

  return { cases: allCases, subtasks };
}

// --- Component ---

export function ProblemCreationPanel() {
  const router = useRouter();
  const locale = useLocale();
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tTestcases = useTranslations("testcases");

  // Basic fields
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [statement, setStatement] = useState("");
  const [inputFormat, setInputFormat] = useState("");
  const [outputFormat, setOutputFormat] = useState("");

  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Judge type
  const [judgeType, setJudgeType] = useState<JudgeType>("standard");
  const [checkerScript, setCheckerScript] = useState("");
  const [interactorScript, setInteractorScript] = useState("");

  // Example test cases (visible to students)
  const [examples, setExamples] = useState<ExampleCase[]>([{ stdin: "", expectedStdout: "" }]);

  // Test data from ZIP
  const [regexPattern, setRegexPattern] = useState("(\\d+)-(\\d+)");
  const [inExt, setInExt] = useState(".in");
  const [outExt, setOutExt] = useState(".out");
  const [parsedCases, setParsedCases] = useState<ParsedCase[]>([]);
  const [subtasks, setSubtasks] = useState<SubtaskConfig[]>([]);
  const [zipFileName, setZipFileName] = useState<string | null>(null);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Tag handlers ---

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag.length > 0 && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  }

  function removeTag(index: number) {
    setTags((prev) => prev.filter((_, i) => i !== index));
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === " " || event.key === "Enter") && tagInput.trim().length > 0) {
      event.preventDefault();
      addTag(tagInput);
    }
    if (event.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  // --- Example handlers ---

  function updateExample(index: number, patch: Partial<ExampleCase>) {
    setExamples((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  // --- ZIP handler ---

  async function handleZipUpload(file: File) {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const allFiles: { name: string; content: string }[] = [];
      const fileNames = Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);

      for (const name of fileNames) {
        const zipEntry = zip.files[name];
        if (!zipEntry) continue;
        const content = await zipEntry.async("string");
        allFiles.push({ name, content });
      }

      const result = detectSubtasksFromFiles(allFiles, regexPattern, inExt, outExt);
      if (result.error) {
        setError(result.error);
        return;
      }
      setParsedCases(result.cases);
      setSubtasks(result.subtasks);
      setZipFileName(file.name);
    } catch {
      setError("Failed to parse ZIP file.");
    }
  }

  // --- Subtask handlers ---

  function updateSubtask(index: number, patch: Partial<SubtaskConfig>) {
    setSubtasks((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function autoSplitEvenly(count: number) {
    if (parsedCases.length === 0 || count < 1) return;
    const perGroup = Math.ceil(parsedCases.length / count);
    const newSubtasks: SubtaskConfig[] = [];
    for (let i = 0; i < count; i++) {
      const start = i * perGroup;
      const end = Math.min(start + perGroup, parsedCases.length);
      if (start >= parsedCases.length) break;
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      newSubtasks.push({
        name: `Subtask ${String(i + 1)}`,
        description: "",
        points: Math.round(100 / count),
        caseIndices: indices
      });
    }
    setSubtasks(newSubtasks);
  }

  function addSubtask() {
    // New subtask with no cases assigned
    setSubtasks((prev) => [
      ...prev,
      {
        name: `Subtask ${String(prev.length + 1)}`,
        description: "",
        points: 0,
        caseIndices: []
      }
    ]);
  }

  // --- Submit ---

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    const rawSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = rawSlug.length >= 3 ? rawSlug : `problem-${String(Date.now())}`;

    try {
      await createProblemMutation({
        checkerScript: judgeType === "checker" ? checkerScript : undefined,
        difficulty,
        inputFormat,
        interactorScript: judgeType === "interactive" ? interactorScript : undefined,
        judgeType,
        outputFormat,
        slug,
        statement,
        summary: "",
        tags,
        title,
        visibility
      });

      // Create example testcase set (visible)
      const validExamples = examples.filter((e) => e.stdin.trim().length > 0);
      if (validExamples.length > 0) {
        await createProblemTestcaseSetMutation(slug, {
          cases: validExamples,
          isHidden: false,
          name: "Examples",
          weight: 0
        });
      }

      // Create subtask testcase sets from parsed ZIP data
      for (const subtask of subtasks) {
        if (subtask.caseIndices.length === 0) continue;
        const cases = subtask.caseIndices.map((idx) => ({
          stdin: parsedCases[idx]?.stdin ?? "",
          expectedStdout: parsedCases[idx]?.expectedStdout ?? ""
        }));
        await createProblemTestcaseSetMutation(slug, {
          cases,
          isHidden: true,
          name: subtask.name,
          weight: subtask.points
        });
      }

      setMessage(`Created ${title}. Redirecting...`);
      startTransition(() => {
        router.push(`/${locale}/problems/${slug}`);
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Problem creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // --- Render ---

  const totalPoints = subtasks.reduce((sum, s) => sum + s.points, 0);

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-white/60 px-6 py-6">
      <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
        {/* Title */}
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("title")}
          <input
            className={inputClassName}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>

        {/* Tags */}
        <div className="text-sm text-[color:var(--color-muted)]">
          <span>{tAdmin("tags")}</span>
          <div
            className="mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag, index) => (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent)]"
                key={tag}
              >
                {tag}
                <button
                  className="ml-0.5 text-[color:var(--color-accent)]/60 hover:text-[color:var(--color-accent)]"
                  onClick={() => removeTag(index)}
                  type="button"
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              className="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tAdmin("tagsPlaceholder")}
              ref={tagInputRef}
              value={tagInput}
            />
          </div>
        </div>

        {/* Difficulty + Visibility */}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("difficulty")}
            <select
              className={inputClassName}
              onChange={(event) =>
                setDifficulty(event.target.value as "easy" | "medium" | "hard")
              }
              value={difficulty}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("visibility")}
            <select
              className={inputClassName}
              onChange={(event) => setVisibility(event.target.value as "public" | "private")}
              value={visibility}
            >
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </label>
        </div>

        {/* Judge Type */}
        <div className="text-sm text-[color:var(--color-muted)]">
          <span>{tAdmin("judgeType")}</span>
          <div className="mt-2 flex gap-4">
            {(["standard", "checker", "interactive"] as const).map((type) => (
              <label className="flex items-center gap-2 text-sm" key={type}>
                <input
                  checked={judgeType === type}
                  className="accent-[color:var(--color-accent)]"
                  name="judgeType"
                  onChange={() => setJudgeType(type)}
                  type="radio"
                  value={type}
                />
                {tAdmin(type)}
              </label>
            ))}
          </div>
        </div>

        {/* Checker Script */}
        {judgeType === "checker" ? (
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("checkerScript")}
            <textarea
              className={`${monoTextareaClassName} min-h-40`}
              onChange={(event) => setCheckerScript(event.target.value)}
              placeholder={CHECKER_TEMPLATE}
              value={checkerScript}
            />
          </label>
        ) : null}

        {/* Interactor Script */}
        {judgeType === "interactive" ? (
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("interactorScript")}
            <textarea
              className={`${monoTextareaClassName} min-h-40`}
              onChange={(event) => setInteractorScript(event.target.value)}
              placeholder={INTERACTOR_TEMPLATE}
              value={interactorScript}
            />
          </label>
        ) : null}

        {/* Statement */}
        <label className="text-sm text-[color:var(--color-muted)]">
          {tAdmin("statement")}
          <textarea
            className={`${textareaClassName} min-h-40`}
            onChange={(event) => setStatement(event.target.value)}
            required
            value={statement}
          />
        </label>

        {/* Input / Output Format */}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("inputFormat")}
            <textarea
              className={textareaClassName}
              onChange={(event) => setInputFormat(event.target.value)}
              value={inputFormat}
            />
          </label>
          <label className="text-sm text-[color:var(--color-muted)]">
            {tAdmin("outputFormat")}
            <textarea
              className={textareaClassName}
              onChange={(event) => setOutputFormat(event.target.value)}
              value={outputFormat}
            />
          </label>
        </div>

        {/* ── Section: Examples ── */}
        <div className="mt-2 border-t border-[color:var(--color-border)] pt-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold">{tTestcases("sampleCases")}</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                {tTestcases("sampleCasesHint")}
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-3">
            {examples.map((ex, i) => (
              <div
                className="rounded-xl border border-[color:var(--color-border)] bg-white/50 px-4 py-3"
                key={`example-${String(i)}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-semibold">
                    {tTestcases("case")} {i + 1}
                  </p>
                  {examples.length > 1 ? (
                    <button
                      className="text-sm text-red-700"
                      onClick={() => setExamples((prev) => prev.filter((_, idx) => idx !== i))}
                      type="button"
                    >
                      {tTestcases("remove")}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <label className="text-sm text-[color:var(--color-muted)]">
                    {tTestcases("stdin")}
                    <textarea
                      className={monoTextareaClassName}
                      onChange={(event) => updateExample(i, { stdin: event.target.value })}
                      value={ex.stdin}
                    />
                  </label>
                  <label className="text-sm text-[color:var(--color-muted)]">
                    {tTestcases("expectedStdout")}
                    <textarea
                      className={monoTextareaClassName}
                      onChange={(event) =>
                        updateExample(i, { expectedStdout: event.target.value })
                      }
                      value={ex.expectedStdout}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              className={`w-fit ${pillButton}`}
              onClick={() =>
                setExamples((prev) => [...prev, { stdin: "", expectedStdout: "" }])
              }
              type="button"
            >
              {tTestcases("addCase")}
            </button>
          </div>
        </div>

        {/* ── Section: Test Data (ZIP + Subtasks) ── */}
        <div className="mt-2 border-t border-[color:var(--color-border)] pt-5">
          <p className="text-sm font-bold">{tTestcases("hiddenCases")}</p>
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            {tTestcases("uploadZipHint")}
          </p>

          {/* Regex pattern + extensions + Upload */}
          <div className="mt-3 rounded-xl border border-dashed border-[color:var(--color-border)] bg-white/40 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[color:var(--color-muted)]">Regex</span>
                  <span className="group relative cursor-help text-[color:var(--color-muted)]">
                    <CircleHelp className="h-3.5 w-3.5" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-[color:var(--color-border)] bg-white px-3 py-2 text-xs text-[color:var(--color-muted)] shadow-lg group-hover:block">
                      {tTestcases("zipStructureHint")}
                    </span>
                  </span>
                </div>
                <input
                  className={`${smallInputClassName} w-48`}
                  onChange={(event) => setRegexPattern(event.target.value)}
                  placeholder="(\d+)-(\d+)"
                  value={regexPattern}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-[color:var(--color-muted)]">Input Extension</span>
                <input
                  className={`${smallInputClassName} w-16`}
                  onChange={(event) => setInExt(event.target.value)}
                  value={inExt}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-[color:var(--color-muted)]">
                  Output Extension
                </span>
                <input
                  className={`${smallInputClassName} w-16`}
                  onChange={(event) => setOutExt(event.target.value)}
                  value={outExt}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-[color:var(--color-muted)]">
                  {tTestcases("uploadZip")}
                </span>
                <input
                  accept=".zip"
                  className="text-xs file:mr-2 file:rounded-full file:border file:border-[color:var(--color-border)] file:bg-white/80 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-white"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleZipUpload(file);
                  }}
                  type="file"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-[color:var(--color-muted)]">
              Group 1 = subtask ID, Group 2 = case ID. e.g.{" "}
              <code className="rounded bg-white/80 px-1">1-01.in</code> → subtask 1, case 01
            </p>
          </div>

          {/* After ZIP: show results + subtask config */}
          {parsedCases.length > 0 ? (
            <div className="mt-4 space-y-4">
              {/* Summary bar */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                  {zipFileName} — {tTestcases("zipUploaded", { count: parsedCases.length })}
                </span>
                <span className="text-xs text-[color:var(--color-muted)]">
                  {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""} detected
                </span>
                <span
                  className={`text-xs font-medium ${totalPoints === 100 ? "text-emerald-600" : "text-amber-600"}`}
                >
                  {totalPoints}/100 pts
                </span>
              </div>

              {/* Auto-split controls */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[color:var(--color-muted)]">
                  Auto-split into:
                </span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      subtasks.length === n
                        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]"
                        : "border-[color:var(--color-border)] hover:bg-white"
                    }`}
                    key={n}
                    onClick={() => autoSplitEvenly(n)}
                    type="button"
                  >
                    {n}
                  </button>
                ))}
                <button
                  className={`ml-2 ${pillButton} py-1 text-xs`}
                  onClick={addSubtask}
                  type="button"
                >
                  + {tTestcases("addSubtask")}
                </button>
              </div>

              {/* Subtask list */}
              <div className="grid gap-4">
                {subtasks.map((subtask, si) => (
                  <div
                    className="rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-5 py-4"
                    key={`subtask-${String(si)}`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Name */}
                      <input
                        className="rounded-xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2 text-sm font-semibold"
                        onChange={(event) => updateSubtask(si, { name: event.target.value })}
                        value={subtask.name}
                      />
                      {/* Points */}
                      <label className="flex items-center gap-2 text-sm text-[color:var(--color-muted)]">
                        {tTestcases("subtaskPoints")}
                        <input
                          className="w-20 rounded-xl border border-[color:var(--color-border)] bg-white/80 px-2 py-2 text-sm"
                          min={0}
                          onChange={(event) =>
                            updateSubtask(si, { points: Number(event.target.value) || 0 })
                          }
                          type="number"
                          value={subtask.points}
                        />
                      </label>
                      {/* Cases count */}
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {subtask.caseIndices.length} cases
                      </span>
                      {/* Remove */}
                      {subtasks.length > 1 ? (
                        <button
                          className="ml-auto text-sm text-red-700 hover:text-red-900"
                          onClick={() => setSubtasks((prev) => prev.filter((_, i) => i !== si))}
                          type="button"
                        >
                          {tTestcases("removeSubtask")}
                        </button>
                      ) : null}
                    </div>

                    {/* Description */}
                    <textarea
                      className="mt-3 w-full rounded-xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2 text-sm"
                      onChange={(event) =>
                        updateSubtask(si, { description: event.target.value })
                      }
                      placeholder={`${subtask.name} description...`}
                      rows={2}
                      value={subtask.description}
                    />

                    {/* Case file list (collapsed) */}
                    {subtask.caseIndices.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)]">
                          Show testcase files
                        </summary>
                        <div className="mt-1 max-h-32 overflow-y-auto rounded border border-[color:var(--color-border)] bg-white/40 px-3 py-2">
                          {subtask.caseIndices.map((idx) => (
                            <p
                              className="text-xs font-mono text-[color:var(--color-muted)]"
                              key={idx}
                            >
                              #{idx + 1} — {parsedCases[idx]?.sourceFile ?? "unknown"}
                            </p>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <p className="mt-2 text-xs text-amber-600">No testcases assigned</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Submit */}
        <button
          className="mt-2 inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? tCommon("creating") : tAdmin("createProblem")}
        </button>
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
