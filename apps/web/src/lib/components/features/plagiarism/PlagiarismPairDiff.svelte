<script lang="ts">
  import { onMount } from "svelte";

  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css.js";
  import { flattenSourcesForDisplay } from "$lib/utils/submission-source-display";
  import type { PlagiarismPairDiffData } from "$lib/types/plagiarism-pair";
  import { createPlagiarismDiffLifecycle } from "./plagiarism-diff-lifecycle";

  interface Props {
    data: PlagiarismPairDiffData;
  }

  let { data }: Props = $props();

  function getInitialPairKey(): string {
    return data.pairKey;
  }

  let diffContainer: HTMLDivElement = $state(null!);
  let diffLifecycle = $state<ReturnType<typeof createPlagiarismDiffLifecycle>>();
  let componentMounted = false;
  let activePairKey = $state(getInitialPairKey());
  let pairGeneration = 0;

  type FlagShape = PlagiarismPairDiffData["flag"];
  let localFlag = $state<{ value: FlagShape } | null>(null);
  const currentFlag = $derived<FlagShape>(localFlag ? localFlag.value : data.flag);

  let isLoading = $state(false);
  let actionError = $state<string | null>(null);
  let editorError = $state<string | null>(null);

  function flattenFiles(files: { path: string; content: string }[] | null): string {
    return flattenSourcesForDisplay(files ?? []);
  }

  function currentSources() {
    return {
      original: flattenFiles(data.left.files),
      modified: flattenFiles(data.right.files),
    };
  }

  function isCurrentPair(generation: number, pairKey: string): boolean {
    return componentMounted && generation === pairGeneration && pairKey === data.pairKey;
  }

  $effect(() => {
    diffLifecycle?.update(currentSources());
  });

  $effect(() => {
    const nextPairKey = data.pairKey;
    if (nextPairKey === activePairKey) return;
    activePairKey = nextPairKey;
    pairGeneration++;
    localFlag = null;
    actionError = null;
    isLoading = false;
  });

  onMount(() => {
    componentMounted = true;
    diffLifecycle = createPlagiarismDiffLifecycle({
      container: diffContainer,
      initialSources: currentSources(),
      loadMonaco: async () => {
        const { loadMonaco } = await import("$lib/utils/monaco-loader");
        return loadMonaco();
      },
      onLoadError: () => {
        if (componentMounted) editorError = m.editor_loadFailed();
      },
    });

    return () => {
      componentMounted = false;
      pairGeneration++;
      diffLifecycle?.dispose();
    };
  });

  async function handleMark() {
    const generation = pairGeneration;
    const pairKey = data.pairKey;
    isLoading = true;
    actionError = null;
    try {
      const res = await fetch("/api/plagiarism-flags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "fetch",
        },
        body: JSON.stringify({
          contextType: data.contextType,
          contextId: data.contextId,
          problemId: data.pair.problemId,
          userAId: data.left.userId,
          userBId: data.right.userId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        flag: { id: string; flaggedBy: string; flaggedAt: string; note: string | null };
      };
      if (!isCurrentPair(generation, pairKey)) return;
      localFlag = { value: body.flag };
    } catch (err) {
      if (!isCurrentPair(generation, pairKey)) return;
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      if (isCurrentPair(generation, pairKey)) isLoading = false;
    }
  }

  async function handleUnmark() {
    if (!currentFlag) return;
    const generation = pairGeneration;
    const pairKey = data.pairKey;
    const flagId = currentFlag.id;
    isLoading = true;
    actionError = null;
    try {
      const res = await fetch(`/api/plagiarism-flags/${encodeURIComponent(flagId)}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      if (!isCurrentPair(generation, pairKey)) return;
      localFlag = { value: null };
    } catch (err) {
      if (!isCurrentPair(generation, pairKey)) return;
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      if (isCurrentPair(generation, pairKey)) isLoading = false;
    }
  }

  const leftLabel = $derived(data.left.username ?? data.left.displayName ?? data.left.userId);
  const rightLabel = $derived(
    data.right.username ?? data.right.displayName ?? data.right.userId,
  );
</script>

<section class="mx-auto flex max-w-screen-2xl flex-col gap-5 px-6 py-8">
  <div class="flex flex-wrap items-baseline justify-between gap-4">
    <div>
      <h1 class="text-title font-medium leading-tight">
        {m.plagiarism_pairDiffTitle()}
      </h1>
      <p class="mt-1 text-body-sm text-muted-foreground">
        {leftLabel} ↔ {rightLabel} ·
        {m.plagiarism_similarityLabel({ value: data.pair.similarity })}
      </p>
    </div>
    <div class="flex items-center gap-2">
      {#if currentFlag}
        <span
          class="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-caption font-semibold text-warning"
        >
          {m.plagiarism_flaggedBadge()}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onclick={() => void handleUnmark()}
        >
          {m.plagiarism_unmark()}
        </Button>
      {:else}
        <Button
          variant="default"
          size="sm"
          disabled={isLoading}
          onclick={() => void handleMark()}
        >
          {m.plagiarism_markFalsePositive()}
        </Button>
      {/if}
    </div>
  </div>

  {#if actionError}
    <div
      role="alert"
      class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-body-sm text-destructive"
    >
      {actionError}
    </div>
  {/if}

  {#if editorError}
    <div
      role="alert"
      class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-body-sm text-destructive"
    >
      {editorError}
    </div>
  {/if}

  <div
    class="grid grid-cols-3 gap-3 rounded-md border border-border bg-[color:var(--color-panel)]/60 px-5 py-4 text-caption text-muted-foreground"
  >
    <div>
      <div class="text-body-sm font-semibold text-foreground">{data.pair.similarity}%</div>
      <div>{m.plagiarism_similarityHeading()}</div>
    </div>
    <div>
      <div class="text-body-sm font-semibold text-foreground">{data.pair.longest}</div>
      <div>{m.plagiarism_longestFragmentHeading()}</div>
    </div>
    <div>
      <div class="text-body-sm font-semibold text-foreground">{data.pair.overlap}</div>
      <div>{m.plagiarism_overlapHeading()}</div>
    </div>
  </div>

  <div
    class="grid grid-cols-2 gap-0 border-b border-border bg-muted/40 px-4 py-2 font-mono text-caption text-muted-foreground rounded-t-md border-x border-t border-border"
  >
    <span>{leftLabel} / source</span>
    <span>{rightLabel} / source</span>
  </div>
  <div
    bind:this={diffContainer}
    class={cn("h-[70vh] w-full overflow-hidden rounded-b-md border-x border-b border-border")}
    aria-label={m.plagiarism_loadingSources()}
  ></div>
</section>
