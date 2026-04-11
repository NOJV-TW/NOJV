<script lang="ts">
  import { untrack } from "svelte";
  import ImageSection from "$lib/components/problem/advanced/ImageSection.svelte";
  import ContainerContractSection from "$lib/components/problem/advanced/ContainerContractSection.svelte";
  import MarkdownRenderer from "$lib/components/layout/MarkdownRenderer.svelte";
  import { toasts } from "$lib/stores/toast";
  import { LinkButton } from "$lib/components/ui/button";
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
  }) {
    const ok = await postAction("updateImage", {
      ref: payload.imageRef,
      source: payload.imageSource,
      timeLimitMs: payload.timeLimitMs,
      memoryLimitMb: payload.memoryLimitMb,
    });
    toasts.add({
      message: ok ? "Image config saved" : "Failed to save image config",
      type: ok ? "success" : "error",
    });
  }
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <header class="flex items-center gap-3">
    <h1 class="font-display text-title-lg">
      {data.problem.title}
    </h1>
    <h2
      class="inline-flex items-center rounded-full border border-info/25 bg-info/15 px-2.5 py-1 text-caption font-medium text-info"
    >
      Advanced mode
    </h2>
    <LinkButton
      class="ml-auto"
      href={`/problems/${data.problem.id}/edit`}
    >
      ← Back to standard editor
    </LinkButton>
  </header>

  <section class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest">
    <h3 class="text-title-sm font-semibold">Statement</h3>
    <p class="mt-1 text-body-sm text-muted-foreground">
      題目標題、敘述、tag 在
      <a class="underline" href={`/problems/${data.problem.id}/edit`}>
        standard editor
      </a>
      編輯。
    </p>
    <article class="prose mt-4 max-w-none text-body-sm dark:prose-invert">
      <MarkdownRenderer content={data.problem.statement ?? ""} />
    </article>
  </section>

  <section class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest">
    <ContainerContractSection />
  </section>

  <section class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest">
    <ImageSection
      problemId={data.problem.id}
      bind:imageRef
      bind:imageSource
      bind:timeLimitMs
      bind:memoryLimitMb
      onsave={saveImage}
    />
  </section>
</div>
