<script lang="ts">
  import { untrack } from "svelte";
  import ImageSection from "$lib/components/problem/advanced/ImageSection.svelte";
  import AdvancedTestcasesSection, {
    type AdvancedCase,
  } from "$lib/components/problem/advanced/AdvancedTestcasesSection.svelte";
  import MarkdownRenderer from "$lib/components/layout/MarkdownRenderer.svelte";
  import { toasts } from "$lib/stores/toast";
  import type { ProblemImageSource } from "@nojv/core";

  let { data } = $props();

  let imageRef = $state<string>(untrack(() => data.imageConfig.ref));
  let imageSource = $state<ProblemImageSource>(
    untrack(() => data.imageConfig.source),
  );
  let timeLimitMs = $state<number>(untrack(() => data.imageConfig.timeLimitMs));
  let memoryLimitMb = $state<number>(
    untrack(() => data.imageConfig.memoryLimitMb),
  );
  let networkEnabled = $state<boolean>(
    untrack(() => data.imageConfig.networkEnabled),
  );

  let cases = $state<AdvancedCase[]>([]);

  async function postAction(action: string, payload: unknown): Promise<boolean> {
    try {
      const fd = new FormData();
      fd.append("data", JSON.stringify(payload));
      const res = await fetch(`?/${action}`, { method: "POST", body: fd });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function saveImage(payload: {
    imageRef: string;
    imageSource: ProblemImageSource;
    timeLimitMs: number;
    memoryLimitMb: number;
    networkEnabled: boolean;
  }) {
    const ok = await postAction("updateImage", {
      ref: payload.imageRef,
      source: payload.imageSource,
      timeLimitMs: payload.timeLimitMs,
      memoryLimitMb: payload.memoryLimitMb,
      networkEnabled: payload.networkEnabled,
    });
    toasts.add({
      message: ok ? "Image config saved" : "Failed to save image config",
      type: ok ? "success" : "error",
    });
  }

  async function saveTestcases(next: AdvancedCase[]) {
    const ok = await postAction("updateAdvancedTestcases", next);
    toasts.add({
      message: ok ? "Testcases saved" : "Failed to save testcases",
      type: ok ? "success" : "error",
    });
  }
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <header class="flex items-center gap-3">
    <h2 class="font-[family-name:var(--font-display)] text-3xl">
      {data.problem.title}
    </h2>
    <span class="rounded-full bg-purple-500/15 px-3 py-1 text-xs font-medium text-purple-600 dark:text-purple-400">
      Advanced mode
    </span>
    <a
      href={`/problems/${data.problem.id}/edit`}
      class="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      ← Back to standard editor
    </a>
  </header>

  <!-- Statement section: minimal placeholder so the UI is usable while Phase 6 -->
  <!-- restructures navigation. Reuses the existing problem record. -->
  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-6">
    <h3 class="text-lg font-semibold">Statement</h3>
    <p class="mt-1 text-sm text-muted-foreground">
      Edit the title, statement, and tags from the
      <a class="underline" href={`/problems/${data.problem.id}/edit`}>
        standard editor
      </a>. Phase 6 will fold this section into the advanced page.
    </p>
    <article class="prose mt-4 max-w-none text-sm dark:prose-invert">
      <MarkdownRenderer content={data.problem.statement ?? ""} />
    </article>
  </section>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-6">
    <ImageSection
      problemId={data.problem.id}
      bind:imageRef
      bind:imageSource
      bind:timeLimitMs
      bind:memoryLimitMb
      bind:networkEnabled
      onsave={saveImage}
    />
  </section>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-6">
    <AdvancedTestcasesSection bind:cases onsave={saveTestcases} />
  </section>
</div>
