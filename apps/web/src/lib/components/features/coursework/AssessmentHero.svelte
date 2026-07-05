<script lang="ts">
  import type { Snippet } from "svelte";
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
    badges?: Snippet;
    actions?: Snippet | undefined;
    aside?: Snippet<[string]>;
    class?: string;
  }

  let { kind, title, summary, badges, actions, aside, class: className }: Props = $props();

  const accent = $derived(typeAccentVar(kind));
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
        <p class="mt-4 max-w-2xl text-body text-muted-foreground line-clamp-2">{summary}</p>
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
</GlassPanel>
