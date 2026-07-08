<script lang="ts">
  import type { ProblemSubmissionEntry } from "$lib/types";
  import type { SubmissionResult } from "@nojv/core";
  import { formatSmartTimestamp } from "$lib/utils/datetime";
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
    viewingId?: string | null;
    canRejudge?: boolean;
    total?: number;
  }

  let {
    submissions = $bindable([]),
    viewingId = $bindable(null),
    canRejudge = false,
    total = 100,
  }: Props = $props();

  const viewingEntry = $derived(
    viewingId === null ? null : (submissions.find((s) => s.id === viewingId) ?? null),
  );

  let loadingSourceId = $state<string | null>(null);
  let sourceErrorIds = $state(new Set<string>());
  let loadingDetailId = $state<string | null>(null);
  let detailLoadedIds = $state(new Set<string>());
  let rejudgingId = $state<string | null>(null);

  async function handleRejudge(submissionId: string) {
    if (rejudgingId !== null) return;
    rejudgingId = submissionId;
    try {
      const res = await fetchWithCsrf(`/api/submissions/${submissionId}/rejudge`, {
        method: "POST",
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
    const entry = viewingEntry;
    if (!entry || !entry.result || entry.sourceCode !== undefined || !entry.id) return;

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
        submissions[currentIdx] = { ...submissions[currentIdx]!, sourceCode: "" };
        sourceErrorIds = new Set([...sourceErrorIds, entryId]);
      })
      .finally(() => {
        if (!cancelled && loadingSourceId === entryId) loadingSourceId = null;
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const entry = viewingEntry;
    if (!entry || !entry.result || !entry.id) return;

    const entryId = entry.id;
    if (detailLoadedIds.has(entryId)) return;
    if (entry.result.caseResults !== undefined || entry.result.subtaskResults !== undefined) {
      detailLoadedIds = new Set([...detailLoadedIds, entryId]);
      return;
    }

    let cancelled = false;
    loadingDetailId = entryId;

    fetch(`/api/submissions/${entryId}`)
      .then((res) => {
        if (!res.ok) return;
        return res.json() as Promise<{
          result: SubmissionResult | null;
          status: string;
        }>;
      })
      .then((data) => {
        if (cancelled || !data?.result) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = { ...submissions[currentIdx]!, result: data.result };
        detailLoadedIds = new Set([...detailLoadedIds, entryId]);
      })
      .catch(() => {
        detailLoadedIds = new Set([...detailLoadedIds, entryId]);
      })
      .finally(() => {
        if (!cancelled && loadingDetailId === entryId) loadingDetailId = null;
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
  {:else if viewingEntry}
    {@const entry = viewingEntry}
    <div>
      <button
        class="mb-4 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
        onclick={() => (viewingId = null)}
        type="button"
      >
        &larr; {m.problemDetail_allSubmissions()}
      </button>

      {#if !entry.result}
        <div class="flex items-center gap-3 py-6">
          <div
            class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
          ></div>
          <div class="flex flex-col">
            <span class="text-body font-semibold text-muted-foreground">
              {m.submission_pending()}
            </span>
            <span class="mt-0.5 text-caption text-muted-foreground">
              {entry.language} · {formatSmartTimestamp(entry.submittedAt)}
            </span>
          </div>
        </div>
      {:else}
        {@const label = formatVerdictLabel(entry.result.verdict)}
        <div class="flex items-baseline gap-3">
          <span
            class="inline-block text-body-lg font-semibold motion-safe:animate-[verdict-pop_320ms_var(--ease-spring)_both] {verdictTone(
              entry.result.verdict,
            )}"
          >
            {label}
          </span>
          {#if entry.result.runtimeMs > 0}
            <span class="text-caption text-muted-foreground tabular-nums">
              {m.submissionDetail_runtime()}: {String(entry.result.runtimeMs)} ms
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
          <span class="tabular-nums" title={m.submissionDetail_finalScoreHint()}>
            {m.submissionDetail_finalScoreLabel()}
            {String(entry.result.score)}/{total}
          </span>
          <span class="tabular-nums">{formatSmartTimestamp(entry.submittedAt)}</span>
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
          {#if ["compile_error", "runtime_error", "system_error"].includes(entry.result.verdict)}
            <pre
              class="mt-3 max-h-64 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{entry
                .result.feedback}</pre>
          {:else}
            <p class="mt-3 text-body-sm leading-6 text-muted-foreground">
              {entry.result.feedback}
            </p>
          {/if}
        {/if}

        <div class="mt-5">
          {#if loadingSourceId === entry.id && entry.sourceCode === undefined}
            <div class="flex items-center gap-2 rounded-md bg-muted px-4 py-3">
              <div
                class="size-4 animate-spin rounded-full border-2 border-border border-t-foreground"
              ></div>
              <span class="text-caption text-muted-foreground"
                >{m.problemDetail_loadingSource()}</span
              >
            </div>
          {:else if entry.id && sourceErrorIds.has(entry.id)}
            <p
              class="rounded-md bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
              role="alert"
            >
              {m.problemDetail_sourceLoadFailed()}
            </p>
          {:else}
            <CodeBlock code={entry.sourceCode ?? ""} language={entry.language} />
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="grid gap-3">
      {#each submissions as entry (entry.id)}
        <button
          class="rounded-md border border-border-subtle px-4 py-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:border-primary/30 hover:bg-accent hover:shadow-rest"
          onclick={() => (viewingId = entry.id ?? null)}
          type="button"
        >
          <div class="flex items-baseline justify-between gap-3">
            {#if entry.result}
              <span class="text-body-sm font-semibold {verdictTone(entry.result.verdict)}">
                {formatVerdictLabel(entry.result.verdict)}
              </span>
            {:else}
              <span
                class="flex items-center gap-2 text-body-sm font-semibold text-muted-foreground"
              >
                <span
                  class="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground"
                  aria-hidden="true"
                ></span>
                {m.submission_pending()}
              </span>
            {/if}
            <span class="text-caption text-muted-foreground tabular-nums">
              {formatSmartTimestamp(entry.submittedAt)}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
            {#if contextLabel(entry.context)}
              <Badge variant="outline" size="xs">{contextLabel(entry.context)}</Badge>
            {/if}
            <span>{entry.language}</span>
            {#if entry.result}
              {#if entry.result.runtimeMs > 0}
                <span class="tabular-nums">{String(entry.result.runtimeMs)} ms</span>
              {/if}
              <span class="tabular-nums">{String(entry.result.score)}/{total}</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
