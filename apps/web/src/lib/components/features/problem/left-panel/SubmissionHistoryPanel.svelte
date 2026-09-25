<script lang="ts">
  import SubmissionId from "$lib/components/features/submission/SubmissionId.svelte";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { ProblemSubmissionEntry } from "$lib/types";
  import {
    isSubmissionPending,
    type SubmissionResult,
    type SubmissionContext,
    type SubmissionOperation,
  } from "@nojv/core";
  import { applySubmissionState } from "$lib/services/problem-submission";
  import {
    submissionRead,
    watchRejudge,
    requestSubmissionRefresh,
  } from "$lib/services/submission-tracker";
  import { onDestroy, untrack } from "svelte";
  import { formatSmartTimestamp } from "$lib/utils/datetime";
  import { formatJudgeOutput, formatMemoryKb } from "$lib/utils/judge-output";
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
    problemId?: string | undefined;
    context?: SubmissionContext | undefined;
    submissions?: ProblemSubmissionEntry[];
    newSubmissionCount?: number;
    onShowLatest?: (() => void) | undefined;
    viewingId?: string | null;
    canRejudge?: boolean;
    total?: number;
  }

  let {
    problemId,
    context,
    submissions = $bindable([]),
    newSubmissionCount = 0,
    onShowLatest,
    viewingId = $bindable(null),
    canRejudge = false,
    total = 100,
  }: Props = $props();

  let hasMore = $state(untrack(() => submissions.length >= 50));
  let loadingMore = $state(false);
  let loadMoreError = $state(false);
  const historyAbort = new AbortController();
  onDestroy(() => historyAbort.abort());

  async function loadMore() {
    const cursor = submissions.at(-1)?.id;
    if (!problemId || !context || !cursor || loadingMore) return;
    loadingMore = true;
    loadMoreError = false;
    try {
      const query = new URLSearchParams({
        problemId,
        workspaceContext: JSON.stringify(context),
        cursor,
      });
      const page = await submissionRead<{
        items: ProblemSubmissionEntry[];
        nextCursor: string | null;
      }>(`/api/submissions?${query}`, historyAbort.signal);
      if (historyAbort.signal.aborted) return;
      const known = new Set(submissions.map((entry) => entry.id));
      submissions = [...submissions, ...page.items.filter((entry) => !known.has(entry.id))];
      hasMore = page.nextCursor !== null;
    } catch {
      if (!historyAbort.signal.aborted) loadMoreError = true;
    } finally {
      loadingMore = false;
    }
  }

  let sentinel: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!sentinel || !hasMore || loadingMore || loadMoreError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root: sentinel.closest("[data-history-scroll]"), rootMargin: "150px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  const viewingEntry = $derived(
    viewingId === null ? null : (submissions.find((s) => s.id === viewingId) ?? null),
  );

  let loadingSourceId = $state<string | null>(null);
  let sourceErrorIds = $state(new Set<string>());
  let detailErrorIds = $state(new Set<string>());
  const detailKey = (entry: ProblemSubmissionEntry) =>
    `${entry.id ?? ""}:${String(entry.judgeGeneration)}:${entry.updatedAt}`;
  let loadingDetailId = $state<string | null>(null);
  const detailLoadedResults = new WeakSet<SubmissionResult>();
  let rejudgingId = $state<string | null>(null);

  async function handleRejudge(submissionId: string) {
    if (rejudgingId !== null) return;
    rejudgingId = submissionId;
    try {
      const res = await fetchWithCsrf(`/api/submissions/${submissionId}/rejudge`, {
        method: "POST",
      });
      if (res.ok) {
        const { workflowId } = (await res.json()) as { workflowId: string };
        const index = submissions.findIndex((entry) => entry.id === submissionId);
        if (index >= 0) {
          const { result: _result, ...entry } = submissions[index]!;
          submissions[index] = { ...entry, status: "queued" };
        }
        watchRejudge(workflowId, [submissionId], () => undefined);
        requestSubmissionRefresh();
        toasts.success(m.rejudge_toast_queuedSingle());
      } else {
        toasts.error(m.rejudge_toast_error());
      }
    } catch {
      toasts.error(m.rejudge_toast_error());
    } finally {
      rejudgingId = null;
    }
  }

  $effect(() => {
    const entry = viewingEntry;
    if (!entry || !entry.result || entry.sourceCode !== undefined || !entry.id) return;

    const entryId = entry.id;
    let cancelled = false;
    const controller = new AbortController();
    loadingSourceId = entryId;

    submissionRead<{ files: { path: string; content: string }[] }>(
      `/api/submissions/${entryId}/source`,
      controller.signal,
    )
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
      controller.abort();
    };
  });

  $effect(() => {
    const entry = viewingEntry;
    if (!entry || !entry.result || !entry.id) return;

    const entryId = entry.id;
    if (detailLoadedResults.has(entry.result) || detailErrorIds.has(detailKey(entry))) return;
    if (entry.result.caseResults !== undefined || entry.result.subtaskResults !== undefined) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    loadingDetailId = entryId;

    submissionRead<SubmissionOperation>(`/api/submissions/${entryId}`, controller.signal)
      .then((data) => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = applySubmissionState(submissions[currentIdx]!, data);
        if (submissions[currentIdx]!.result)
          detailLoadedResults.add(submissions[currentIdx]!.result!);
      })
      .catch(() => {
        if (!cancelled) detailErrorIds = new Set([...detailErrorIds, detailKey(entry)]);
      })
      .finally(() => {
        if (!cancelled && loadingDetailId === entryId) loadingDetailId = null;
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  });
</script>

{#if viewingEntry && detailErrorIds.has(detailKey(viewingEntry))}
  <button
    type="button"
    class="p-3 text-body-sm text-destructive"
    onclick={() => {
      const errors = new Set(detailErrorIds);
      if (viewingEntry) errors.delete(detailKey(viewingEntry));
      detailErrorIds = errors;
    }}>{m.submissions_loadFailed()} {m.common_retry()}</button
  >
{/if}

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

      {#if isSubmissionPending(entry.status)}
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
        {#if entry.id}
          <div class="mt-3">
            <p class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.submission_id()}
            </p>
            <SubmissionId id={entry.id} />
          </div>
        {/if}
      {:else if !entry.result}
        <p class="text-body font-semibold {verdictTone(entry.status)}">
          {formatVerdictLabel(entry.status)}
        </p>
        <p class="mt-2 text-body-sm text-muted-foreground">{m.submissions_loadFailed()}</p>
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
          {#if entry.result.memoryKb != null && entry.result.memoryKb > 0}
            <span class="text-caption text-muted-foreground tabular-nums">
              {m.submissionDetail_memory()}: {formatMemoryKb(entry.result.memoryKb)}
            </span>
          {/if}
          <span
            data-testid="submission-score"
            class="ml-auto text-body-sm font-semibold tabular-nums {verdictTone(
              entry.result.verdict,
            )}"
          >
            {String(entry.result.score)}/{total}
          </span>
          {#if canRejudge && entry.id}
            <button
              class="inline-flex size-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={rejudgingId === entry.id}
              onclick={() => handleRejudge(entry.id!)}
              type="button"
              aria-label={m.rejudge_single_button()}
              title={m.rejudge_single_button()}
            >
              <RotateCcw aria-hidden="true" class="size-4" />
            </button>
          {/if}
        </div>

        <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
          <span>{entry.language}</span>
          <span class="tabular-nums">{formatSmartTimestamp(entry.submittedAt)}</span>
        </div>

        {#if entry.id}
          <div class="mt-3">
            <p class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.submission_id()}
            </p>
            <SubmissionId id={entry.id} />
          </div>
        {/if}

        {#if entry.result.subtaskResults && entry.result.subtaskResults.length > 0}
          <div class="mt-4">
            <SubtaskResultTree subtaskResults={entry.result.subtaskResults} showScore={false} />
          </div>
        {:else if entry.result.caseResults && entry.result.caseResults.length > 0}
          <div class="mt-4">
            <CaseResultGrid cases={entry.result.caseResults} />
          </div>
        {/if}

        {#if entry.result.feedback && entry.result.verdict !== "accepted"}
          {#if ["compile_error", "runtime_error", "system_error"].includes(entry.result.verdict)}
            <pre
              class="mt-3 max-h-64 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{formatJudgeOutput(
                entry.result.feedback,
              )}</pre>
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
      {#if newSubmissionCount > 0}
        <button
          type="button"
          class="rounded-md border border-primary px-4 py-3 text-body-sm"
          onclick={onShowLatest}>{m.submissions_newRecordsAvailable()}</button
        >
      {/if}
      {#each submissions as entry (entry.id)}
        <button
          class="rounded-md border border-border-subtle px-4 py-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:border-primary/30 hover:bg-accent hover:shadow-rest"
          onclick={() => (viewingId = entry.id ?? null)}
          type="button"
        >
          <div class="flex items-baseline justify-between gap-3">
            {#if !isSubmissionPending(entry.status)}
              <span class="text-body-sm font-semibold {verdictTone(entry.status)}">
                {formatVerdictLabel(entry.status)}
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
            {#if !isSubmissionPending(entry.status) && entry.result}
              {#if entry.result.runtimeMs > 0}
                <span class="tabular-nums">{String(entry.result.runtimeMs)} ms</span>
              {/if}
              <span class="tabular-nums">{String(entry.result.score)}/{total}</span>
            {/if}
          </div>
        </button>
      {/each}
      {#if hasMore && problemId && context}
        <div bind:this={sentinel} aria-hidden="true"></div>
        <button
          class="rounded-md border border-border px-4 py-3 text-body-sm disabled:opacity-50"
          disabled={loadingMore}
          onclick={() => void loadMore()}
          type="button"
          aria-busy={loadingMore}
        >
          {loadingMore
            ? m.submissions_loadingMore()
            : loadMoreError
              ? m.common_retry()
              : m.admin_submissions_next()}
        </button>
      {/if}
      {#if loadMoreError}
        <p class="text-body-sm text-destructive" role="alert">{m.submissions_loadFailed()}</p>
      {/if}
    </div>
  {/if}
</div>
