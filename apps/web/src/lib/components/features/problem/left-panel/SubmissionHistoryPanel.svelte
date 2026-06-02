<script lang="ts">
  import type { ProblemSubmissionEntry } from "$lib/types";
  import { formatTime } from "$lib/utils/datetime";
  import { formatVerdictLabel, verdictTone } from "$lib/utils/verdict-style";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import { flattenSourcesForDisplay } from "$lib/utils/submission-source-display";
  import CodeBlock from "$lib/components/primitives/ui/CodeBlock.svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import SubtaskResultTree from "$lib/components/features/submission/SubtaskResultTree.svelte";
  import CaseResultGrid from "$lib/components/features/submission/CaseResultGrid.svelte";
  import { toasts } from "$lib/stores/toast";

  function contextLabel(kind: ProblemSubmissionEntry["context"]): string | null {
    switch (kind) {
      case "practice":
        return m.submissions_kind_practice();
      case "assignment":
        return m.submissions_kind_assignment();
      case "contest":
        return m.submissions_kind_contest();
      case "exam":
        return m.submissions_kind_exam();
      default:
        return null;
    }
  }

  interface Props {
    submissions?: ProblemSubmissionEntry[];
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
        return res.json() as Promise<{ files: { path: string; content: string }[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        const sourceCode = flattenSourcesForDisplay(data.files);
        submissions[currentIdx] = { ...submissions[currentIdx]!, sourceCode };
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
        <span class="text-body-lg font-semibold {verdictTone(entry.result.verdict)}">
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
          <SubtaskResultTree subtaskResults={entry.result.subtaskResults} />
        </div>
      {:else if entry.result.caseResults && entry.result.caseResults.length > 0}
        <div class="mt-4">
          <CaseResultGrid cases={entry.result.caseResults} />
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
          class="rounded-md border border-border-subtle-subtle px-4 py-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:border-primary/30 hover:bg-accent hover:shadow-rest"
          onclick={() => (viewingIndex = index)}
          type="button"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-body-sm font-semibold {verdictTone(entry.result.verdict)}">
              {label}
            </span>
            <span class="text-caption text-muted-foreground tabular-nums">
              {formatTime(entry.submittedAt)}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
            {#if contextLabel(entry.context)}
              <Badge variant="outline" size="xs">{contextLabel(entry.context)}</Badge>
            {/if}
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
