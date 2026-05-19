<script lang="ts">
  import type { ProblemSubmissionEntry } from "$lib/types";
  import { formatTime } from "$lib/utils/datetime";
  import { formatVerdictLabel, verdictColor } from "$lib/utils/verdict-style";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import CodeBlock from "$lib/components/primitives/ui/CodeBlock.svelte";
  import SubtaskResults from "./SubtaskResults.svelte";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    /**
     * Bindable submission history. The parent owns ingestion (push new
     * results from Run/Submit); this panel renders + mutates entries
     * in-place to attach lazily-fetched source code.
     */
    submissions?: ProblemSubmissionEntry[];
    /** Bindable index of the focused entry; `null` shows the list view. */
    viewingIndex?: number | null;
    canRejudge?: boolean;
  }

  let {
    submissions = $bindable([]),
    viewingIndex = $bindable(null),
    canRejudge = false
  }: Props = $props();

  let loadingSourceId = $state<string | null>(null);
  let rejudgingId = $state<string | null>(null);

  async function handleRejudge(submissionId: string) {
    if (rejudgingId !== null) return;
    rejudgingId = submissionId;
    try {
      const res = await fetchWithCsrf(`/api/submissions/${submissionId}/rejudge`, {
        method: "POST"
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.rejudge_toast_queuedSingle() });
      } else {
        toasts.add({ type: "error", message: m.rejudge_toast_error() });
      }
    } catch {
      toasts.add({ type: "error", message: m.rejudge_toast_error() });
    } finally {
      rejudgingId = null;
    }
  }

  // Lazy-fetch the source code for the submission currently in focus. We key
  // the work off the entry ID (not the array index) and gate writes on a
  // per-effect-run `cancelled` flag so that:
  //   1. if `viewingIndex` changes before the request resolves, the late
  //      response is dropped (the cleanup callback flips `cancelled`),
  //   2. if the parent re-shuffles `submissions` between dispatch and
  //      resolution, we re-locate the target entry by ID at write time, and
  //   3. if the entry has been dropped entirely (e.g. truncated off the
  //      50-entry tail), the response is discarded silently.
  $effect(() => {
    const idx = viewingIndex;
    if (idx === null) return;

    const entry = submissions[idx];
    if (!entry || entry.sourceCode !== undefined || !entry.id) return;

    const entryId = entry.id;
    let cancelled = false;
    loadingSourceId = entryId;

    fetch(`/api/submissions/${entryId}/source`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load source code.");
        return res.json() as Promise<{ sourceCode: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = { ...submissions[currentIdx]!, sourceCode: data.sourceCode };
      })
      .catch(() => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = {
          ...submissions[currentIdx]!,
          sourceCode: "// Failed to load source code."
        };
      })
      .finally(() => {
        if (!cancelled && loadingSourceId === entryId) loadingSourceId = null;
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="p-5">
  {#if submissions.length === 0}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.problemDetail_noSubmissions()}
    </p>
  {:else if viewingIndex !== null && submissions[viewingIndex]}
    {@const entry = submissions[viewingIndex]!}
    {@const label = formatVerdictLabel(entry.result.verdict)}
    <div>
      <button
        class="mb-4 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
        onclick={() => (viewingIndex = null)}
        type="button"
      >
        &larr; {m.problemDetail_allSubmissions()}
      </button>

      <div class="flex items-baseline gap-3">
        <span
          class="text-body-lg font-semibold {verdictColor[entry.result.verdict] ??
            'text-foreground'}"
        >
          {label}
        </span>
        {#if entry.result.runtimeMs > 0}
          <span class="text-caption text-muted-foreground tabular-nums">
            Runtime: {String(entry.result.runtimeMs)} ms
          </span>
        {/if}
        {#if canRejudge && entry.id}
          <button
            class="ml-auto rounded-md border border-border px-2.5 py-1 text-caption font-medium transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={rejudgingId === entry.id}
            onclick={() => handleRejudge(entry.id!)}
            type="button"
          >
            {m.rejudge_single_button()}
          </button>
        {/if}
      </div>

      <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
        <span>{entry.language}</span>
        <span class="tabular-nums">{String(entry.result.score)}/100</span>
        <span class="tabular-nums">{formatTime(entry.submittedAt)}</span>
      </div>

      {#if entry.result.subtaskResults && entry.result.subtaskResults.length > 0}
        <div class="mt-4">
          <SubtaskResults subtaskResults={entry.result.subtaskResults} />
        </div>
      {:else if entry.result.caseResults && entry.result.caseResults.length > 0}
        <div class="mt-4 flex flex-wrap items-center gap-1">
          {#each entry.result.caseResults as cr, i (`cr-${i}`)}
            <span
              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-caption font-medium {cr.passed
                ? 'bg-success/15 text-success'
                : 'bg-destructive/15 text-destructive'}"
            >
              {cr.passed ? "✔" : "✘"} Case {i + 1}
            </span>
          {/each}
        </div>
      {:else if entry.result.feedback}
        <p class="mt-3 text-body-sm leading-6 text-muted-foreground">
          {entry.result.feedback}
        </p>
      {/if}

      <div class="mt-5">
        {#if loadingSourceId === entry.id && entry.sourceCode === undefined}
          <div class="flex items-center gap-2 rounded-md bg-muted px-4 py-3">
            <div
              class="size-4 animate-spin rounded-full border-2 border-border border-t-foreground"
            ></div>
            <span class="text-caption text-muted-foreground">{m.problemDetail_loadingSource()}</span>
          </div>
        {:else}
          <CodeBlock code={entry.sourceCode ?? ""} language={entry.language} />
        {/if}
      </div>
    </div>
  {:else}
    <div class="grid gap-3">
      {#each submissions as entry, index (`sub-${index}`)}
        {@const label = formatVerdictLabel(entry.result.verdict)}
        <button
          class="rounded-md border border-border-subtle px-4 py-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:border-primary/30 hover:bg-accent hover:shadow-rest"
          onclick={() => (viewingIndex = index)}
          type="button"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span
              class="text-body-sm font-semibold {verdictColor[entry.result.verdict] ??
                'text-foreground'}"
            >
              {label}
            </span>
            <span class="text-caption text-muted-foreground tabular-nums">
              {formatTime(entry.submittedAt)}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
            <span>{entry.language}</span>
            {#if entry.result.runtimeMs > 0}
              <span class="tabular-nums">{String(entry.result.runtimeMs)} ms</span>
            {/if}
            <span class="tabular-nums">{String(entry.result.score)}/100</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
