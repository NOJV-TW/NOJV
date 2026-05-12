<script lang="ts" module>
  import type { plagiarismDomain } from "@nojv/domain";

  export interface PlagiarismPairDiffData {
    pair: {
      similarity: number;
      longest: number;
      overlap: number;
      problemId: string;
    };
    pairKey: string;
    contextType: plagiarismDomain.PlagiarismContext;
    contextId: string;
    left: {
      userId: string;
      displayName: string | null;
      username: string | null;
      sourceCode: string | null;
    };
    right: {
      userId: string;
      displayName: string | null;
      username: string | null;
      sourceCode: string | null;
    };
    flag: {
      id: string;
      flaggedBy: string;
      flaggedAt: string;
      note: string | null;
    } | null;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import type * as Monaco from "monaco-editor";

  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils.js";
  import { defineNojvThemes, getNojvThemeName } from "$lib/utils/monaco-themes";

  interface Props {
    data: PlagiarismPairDiffData;
  }

  let { data }: Props = $props();

  let diffContainer: HTMLDivElement = $state(null!);
  let diffEditor: Monaco.editor.IStandaloneDiffEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  type FlagShape = PlagiarismPairDiffData["flag"];
  let localFlag = $state<{ value: FlagShape } | null>(null);
  const currentFlag = $derived<FlagShape>(localFlag ? localFlag.value : data.flag);

  let busy = $state(false);
  let actionError = $state<string | null>(null);

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");
      defineNojvThemes(monacoModule);
      const isDark = document.documentElement.classList.contains("dark");

      diffEditor = monacoModule.editor.createDiffEditor(diffContainer, {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        theme: getNojvThemeName(isDark),
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });

      const original = monacoModule.editor.createModel(data.left.sourceCode ?? "", "plaintext");
      const modified = monacoModule.editor.createModel(data.right.sourceCode ?? "", "plaintext");
      diffEditor.setModel({ original, modified });

      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(getNojvThemeName(dark));
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    })();

    return () => {
      themeObserver?.disconnect();
      const m = diffEditor?.getModel();
      m?.original.dispose();
      m?.modified.dispose();
      diffEditor?.dispose();
    };
  });

  async function handleMark() {
    busy = true;
    actionError = null;
    try {
      const res = await fetch("/api/plagiarism/flag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
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
      localFlag = { value: body.flag };
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handleUnmark() {
    if (!currentFlag) return;
    busy = true;
    actionError = null;
    try {
      const res = await fetch(`/api/plagiarism/flag/${encodeURIComponent(currentFlag.id)}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      localFlag = { value: null };
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  const leftLabel = $derived(
    data.left.username ?? data.left.displayName ?? data.left.userId,
  );
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
        <Button variant="outline" size="sm" disabled={busy} onclick={() => void handleUnmark()}>
          {m.plagiarism_unmark()}
        </Button>
      {:else}
        <Button variant="default" size="sm" disabled={busy} onclick={() => void handleMark()}>
          {m.plagiarism_markFalsePositive()}
        </Button>
      {/if}
    </div>
  </div>

  {#if actionError}
    <div
      class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-body-sm text-destructive"
    >
      {actionError}
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
