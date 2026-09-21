<script lang="ts">
  import { untrack } from "svelte";
  import type { Snippet } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import DotGrid from "$lib/components/primitives/visual/DotGrid.svelte";
  import { typeAccentVar } from "./type-accent.js";
  import type { CourseworkKind } from "./StatusPill.svelte";

  interface Props {
    kind: CourseworkKind;
    typeLabel: string;
    context?: string;
    title: string;
    summary?: string;
    summaryId: string;
    badges?: Snippet;
    meta?: Snippet;
    actions?: Snippet | undefined;
    aside?: Snippet<[string]>;
    class?: string;
  }

  let {
    kind,
    title,
    summary,
    summaryId,
    badges,
    meta,
    actions,
    aside,
    class: className,
  }: Props = $props();

  const accent = $derived(typeAccentVar(kind));
  let summaryElement: HTMLParagraphElement | undefined = $state();
  let summaryExpanded = $state(false);
  let summaryOverflows = $state(false);
  let previousSummary = $state(untrack(() => summary));

  $effect(() => {
    if (summary !== previousSummary) {
      previousSummary = summary;
      summaryExpanded = false;
      summaryOverflows = false;
    }
  });

  $effect(() => {
    const element = summaryElement;
    if (!summary || !element || summaryExpanded) return;

    const measureOverflow = () => {
      summaryOverflows = element.scrollHeight > element.clientHeight + 1;
    };

    measureOverflow();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureOverflow);
      return () => window.removeEventListener("resize", measureOverflow);
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<GlassPanel class={cn("relative overflow-hidden p-7 lg:p-9", className)}>
  <span
    class="pointer-events-none absolute inset-y-0 left-0 w-1.5"
    style="background: {accent};"
    aria-hidden="true"
  ></span>
  <span
    class="pointer-events-none absolute inset-0"
    style="background: radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, {accent} 9%, transparent), transparent 55%);"
    aria-hidden="true"
  ></span>
  <DotGrid opacity={0.12} />
  <div class="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0 flex-1">
      {#if badges}
        <div class="flex flex-wrap items-center gap-3">
          {@render badges()}
        </div>
      {/if}

      <h1
        class="mt-2 pb-1 text-headline lg:text-display font-semibold tracking-tight line-clamp-2"
      >
        {title}
      </h1>

      {#if summary}
        <div class="mt-4 max-w-2xl">
          <p
            bind:this={summaryElement}
            id={summaryId}
            class={cn("text-body text-muted-foreground", !summaryExpanded && "line-clamp-2")}
          >
            {summary}
          </p>
          {#if summaryOverflows}
            <button
              type="button"
              aria-controls={summaryId}
              aria-expanded={summaryExpanded}
              onclick={() => (summaryExpanded = !summaryExpanded)}
              class="focus-ring mt-2 inline-flex rounded-sm text-body-sm font-medium text-primary transition-colors hover:underline"
            >
              {summaryExpanded
                ? m.coursework_summaryShowLess()
                : m.coursework_summaryShowMore()}
            </button>
          {/if}
        </div>
      {/if}

      {#if actions}
        <div class="mt-6">
          {@render actions()}
        </div>
      {/if}
    </div>
    {#if aside}
      <div class="shrink-0">
        {@render aside(accent)}
      </div>
    {/if}
  </div>
  {#if meta}
    <div class="relative mt-6">
      {@render meta()}
    </div>
  {/if}
</GlassPanel>
