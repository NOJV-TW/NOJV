<script lang="ts" module>
  export interface PlagiarismReportPair {
    userId1: string;
    userId2: string;
    problemId: string;
    similarity: number;
    longest: number;
    overlap: number;
  }

  export interface PlagiarismReportData {
    status: "pending" | "running" | "completed" | "failed";
    reportUrl: string | null;
    triggeredAt: string | null;
    completedAt: string | null;
    results: unknown;
  }

  export interface PlagiarismProblemEntry {
    problemId: string;
    letter: string;
    title: string;
  }

  export interface PlagiarismStudentEntry {
    userId: string;
    displayName: string;
    handle: string;
  }

  export interface PlagiarismFlagEntry {
    id: string;
    pairKey: string;
    flaggedBy: string;
    flaggedAt: string;
    note: string | null;
  }

  export function pairKeyOf(pair: PlagiarismReportPair): string {
    const [a, b] = [pair.userId1, pair.userId2].sort();
    return `${a}|${b}|${pair.problemId}`;
  }
</script>

<script lang="ts">
  import { Button } from "#lib/components/primitives/ui/button/index.js";
  import { fetchWithCsrf } from "#lib/services/http.js";
  import { formatDateTime } from "#lib/utils/datetime.js";
  import { m } from "#lib/paraglide/messages.js";
  import { cn } from "#lib/utils/css.js";
  import PlagiarismFlagPanel from "./PlagiarismFlagPanel.svelte";
  import PlagiarismPairTable from "./PlagiarismPairTable.svelte";

  interface Props {
    report: PlagiarismReportData | null;
    problems: PlagiarismProblemEntry[];
    students: PlagiarismStudentEntry[];
    flags?: PlagiarismFlagEntry[];
    diffContext?: { type: "assessment" | "contest" | "exam"; id: string };
    closedExamAt?: number | undefined;
    readOnly?: boolean;
    class?: string;
  }

  let {
    report: initialReport,
    problems,
    students,
    flags = [],
    diffContext,
    closedExamAt,
    readOnly = false,
    class: className,
  }: Props = $props();

  let report = $derived(initialReport);
  const reportsUrl = $derived(
    diffContext
      ? `/api/plagiarism/${encodeURIComponent(diffContext.id)}/reports?type=${diffContext.type}`
      : null,
  );
  let submitting = $state(false);
  let requestError = $state("");
  const working = $derived(report?.status === "running" || report?.status === "pending");

  const awaitingFinal = $derived(
    !readOnly &&
      closedExamAt !== undefined &&
      (!report?.triggeredAt || Date.parse(report.triggeredAt) < closedExamAt),
  );
  const pollDelay = $derived(working ? 2000 : awaitingFinal ? 15000 : null);

  async function checkedResponse(response: Response) {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `HTTP ${String(response.status)}`);
    }
    return response;
  }

  async function runReport() {
    const url = reportsUrl;
    if (!url || submitting) return;
    submitting = true;
    requestError = "";
    try {
      await checkedResponse(await fetchWithCsrf(url, { method: "POST" }));
      if (reportsUrl === url) {
        report = {
          status: "pending",
          triggeredAt: null,
          completedAt: null,
          reportUrl: null,
          results: null,
        };
      }
    } catch (error) {
      if (reportsUrl === url)
        requestError = error instanceof Error ? error.message : String(error);
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    const url = reportsUrl;
    const delay = pollDelay;
    if (!url || delay === null) return;
    const abort = new AbortController();
    let timer = setTimeout(poll, delay);
    async function poll() {
      if (!url || delay === null) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, delay);
        return;
      }
      try {
        const response = await checkedResponse(await fetch(url, { signal: abort.signal }));
        const { reports } = (await response.json()) as { reports: PlagiarismReportData[] };
        if (abort.signal.aborted) return;
        report = reports[0] ?? null;
        requestError = "";
      } catch (error) {
        if (abort.signal.aborted) return;
        requestError = error instanceof Error ? error.message : String(error);
      }
      timer = setTimeout(poll, delay);
    }
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  });

  let showFlagged = $state(false);

  const flaggedKeys = $derived(new Set(flags.map((f) => f.pairKey)));

  const problemsById = $derived(new Map(problems.map((p) => [p.problemId, p])));
  const studentsById = $derived(new Map(students.map((s) => [s.userId, s])));

  function parsePairs(raw: unknown): PlagiarismReportPair[] {
    if (!raw || typeof raw !== "object") return [];
    const obj = raw as { pairs?: unknown };
    if (!Array.isArray(obj.pairs)) return [];
    return obj.pairs
      .map((p: unknown): PlagiarismReportPair | null => {
        if (!p || typeof p !== "object") return null;
        const o = p as Record<string, unknown>;
        if (
          typeof o.userId1 !== "string" ||
          typeof o.userId2 !== "string" ||
          typeof o.problemId !== "string" ||
          typeof o.similarity !== "number"
        ) {
          return null;
        }
        return {
          userId1: o.userId1,
          userId2: o.userId2,
          problemId: o.problemId,
          similarity: o.similarity,
          longest: typeof o.longest === "number" ? o.longest : 0,
          overlap: typeof o.overlap === "number" ? o.overlap : 0,
        };
      })
      .filter((p): p is PlagiarismReportPair => p !== null);
  }

  const pairs = $derived(report ? parsePairs(report.results) : []);
  const sortedPairs = $derived.by(() => {
    const copy = [...pairs];
    copy.sort((a, b) => b.similarity - a.similarity);
    return copy;
  });

  const visiblePairs = $derived.by(() => {
    if (showFlagged) return sortedPairs;
    return sortedPairs.filter((p) => !flaggedKeys.has(pairKeyOf(p)));
  });
  const flaggedHiddenCount = $derived(
    sortedPairs.filter((p) => flaggedKeys.has(pairKeyOf(p))).length,
  );

  function diffHrefFor(p: PlagiarismReportPair): string | null {
    if (!diffContext) return null;
    const composite = `${diffContext.type}:${diffContext.id}:${pairKeyOf(p)}`;
    return `/plagiarism/pairs/${encodeURIComponent(composite)}`;
  }

  const highPairs = $derived(visiblePairs.filter((p) => p.similarity >= 70));
  const mediumPairs = $derived(
    visiblePairs.filter((p) => p.similarity >= 50 && p.similarity < 70),
  );
  const totalPairs = $derived(visiblePairs.length);

  const histogram = $derived.by(() => {
    const buckets = new Array(10).fill(0);
    for (const p of visiblePairs) {
      const idx = Math.min(9, Math.max(0, Math.floor(p.similarity / 10)));
      buckets[idx] += 1;
    }
    const max = Math.max(1, ...buckets);
    return buckets.map((count, idx) => ({
      idx,
      count,
      heightPct: Math.round((count / max) * 100),
      variant: idx >= 7 ? "danger" : idx >= 5 ? "warn" : "default",
    }));
  });

  const studentName = (userId: string) => studentsById.get(userId)?.displayName ?? userId;
  const studentHandle = (userId: string) => studentsById.get(userId)?.handle ?? "";
  const problemLetter = (problemId: string) => problemsById.get(problemId)?.letter ?? "?";
  const problemTitle = (problemId: string) => problemsById.get(problemId)?.title ?? "";

  let expandedPairKeys = $state<Set<string>>(new Set());
  function pairKey(p: PlagiarismReportPair): string {
    return `${p.userId1}-${p.userId2}-${p.problemId}`;
  }
  function togglePair(p: PlagiarismReportPair) {
    const key = pairKey(p);
    const next = new Set(expandedPairKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedPairKeys = next;
  }
</script>

<section data-slot="assignment-plagiarism" class={cn("space-y-5", className)}>
  <PlagiarismFlagPanel
    lastRunLabel={formatDateTime(report?.completedAt ?? "")}
    {showFlagged}
    showToggle={report?.status === "completed" && (flags.length > 0 || flaggedHiddenCount > 0)}
    {flaggedHiddenCount}
    onShowFlaggedChange={(next) => (showFlagged = next)}
  />

  {#if !readOnly && reportsUrl}
    <Button variant="outline" size="sm" onclick={runReport} disabled={submitting}>
      {m.plagiarism_run()}
    </Button>
  {/if}
  {#if requestError}
    <p class="text-body-sm text-destructive" role="alert">{requestError}</p>
  {/if}
  {#if !report}
    <div
      class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {diffContext?.type === "exam" && !readOnly
        ? m.plagiarism_examNotRun()
        : m.plagiarism_notRun()}
    </div>
  {:else if report.status === "pending"}
    <div
      class="rounded-md border border-border bg-[color:var(--color-panel)] px-5 py-4 text-body-sm text-muted-foreground"
    >
      {m.assignmentDetail_plagStatusPending()}
    </div>
  {:else if report.status === "running"}
    <div
      class="rounded-md border border-border bg-[color:var(--color-panel)] px-5 py-4 text-body-sm text-muted-foreground"
    >
      {m.assignmentDetail_plagStatusRunning()}
    </div>
  {:else if report.status === "failed"}
    <div
      class="rounded-md border border-destructive/40 bg-destructive/5 px-5 py-4 text-body-sm text-destructive"
    >
      {m.assignmentDetail_plagStatusFailed()}
    </div>
  {:else}
    <div
      class="flex flex-wrap items-center justify-between gap-6 rounded-md border border-destructive/25 bg-destructive/[0.04] border-l-[4px] border-l-destructive px-6 py-5"
    >
      <div class="flex items-center gap-8">
        <div>
          <div class="text-headline font-medium leading-none text-destructive">
            {highPairs.length}
          </div>
          <div class="mt-2 text-body-sm text-muted-foreground">
            {m.assignmentDetail_plagHigh()}
          </div>
        </div>
        <div>
          <div class="text-headline font-medium leading-none text-warning">
            {mediumPairs.length}
          </div>
          <div class="mt-2 text-body-sm text-muted-foreground">
            {m.assignmentDetail_plagMedium()}
          </div>
        </div>
        <div>
          <div class="text-headline font-medium leading-none text-muted-foreground">
            {totalPairs}
          </div>
          <div class="mt-2 text-body-sm text-muted-foreground">
            {m.assignmentDetail_plagTotal()}
          </div>
        </div>
      </div>
    </div>

    {#if totalPairs > 0}
      <div class="rounded-md border border-border bg-[color:var(--color-panel)]/60 px-5 py-5">
        <div class="mb-3 flex items-baseline justify-between">
          <h4 class="text-body-sm font-semibold">
            {m.assignmentDetail_plagHistogramHeading()}
          </h4>
          <span class="text-caption text-muted-foreground">
            {m.assignmentDetail_plagHistogramHint()}
          </span>
        </div>
        <div class="grid grid-cols-10 items-end gap-1" style="height: 80px">
          {#each histogram as bar (bar.idx)}
            <div
              class={cn(
                "relative rounded-t-[2px] transition-[filter] duration-fast",
                bar.variant === "danger" &&
                  "bg-gradient-to-b from-destructive to-destructive/40",
                bar.variant === "warn" && "bg-gradient-to-b from-warning to-warning/40",
                bar.variant === "default" && "bg-gradient-to-b from-muted-foreground to-border",
              )}
              style={`height: ${bar.heightPct}%`}
            >
              <span
                class="absolute -top-4 left-1/2 -translate-x-1/2 text-micro font-semibold text-muted-foreground"
              >
                {bar.count}
              </span>
            </div>
          {/each}
        </div>
        <div
          class="mt-2 grid grid-cols-10 gap-1 text-center font-mono text-micro text-muted-foreground"
        >
          {#each histogram as bar (`label-${bar.idx}`)}
            <span>{bar.idx * 10}-{(bar.idx + 1) * 10}</span>
          {/each}
        </div>
      </div>

      {#if highPairs.length > 0}
        <p
          class="mt-6 font-mono text-micro font-semibold uppercase tracking-[0.1em] text-muted-foreground"
        >
          {m.assignmentDetail_plagPairsHighHeading()}
        </p>
        <PlagiarismPairTable
          pairs={highPairs}
          variant="high"
          {flaggedKeys}
          {expandedPairKeys}
          {pairKey}
          {pairKeyOf}
          {studentName}
          {studentHandle}
          {problemLetter}
          {problemTitle}
          {diffHrefFor}
          onTogglePair={togglePair}
        />
      {/if}

      {#if mediumPairs.length > 0}
        <p
          class="mt-6 font-mono text-micro font-semibold uppercase tracking-[0.1em] text-muted-foreground"
        >
          {m.assignmentDetail_plagPairsMediumHeading()}
        </p>
        <PlagiarismPairTable
          pairs={mediumPairs}
          variant="medium"
          {flaggedKeys}
          {expandedPairKeys}
          {pairKey}
          {pairKeyOf}
          {studentName}
          {studentHandle}
          {problemLetter}
          {problemTitle}
          {diffHrefFor}
          onTogglePair={togglePair}
        />
      {/if}
    {/if}
  {/if}
</section>
