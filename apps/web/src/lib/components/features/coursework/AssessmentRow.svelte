<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronRight } from "@lucide/svelte";
  import { cn } from "$lib/utils/css.js";
  import StatusPill from "./StatusPill.svelte";
  import { typeAccentVar } from "./type-accent.js";
  import type { CourseworkKind } from "./StatusPill.svelte";

  interface Props {
    href: string;
    kind: CourseworkKind;
    typeLabel: string;
    context?: string;
    title: string;
    status: string;
    timing?: Snippet;
    foot?: Snippet;
    delay?: number;
    class?: string;
  }

  let {
    href,
    kind,
    typeLabel,
    context,
    title,
    status,
    timing,
    foot,
    delay = 0,
    class: className,
  }: Props = $props();

  const accent = $derived(typeAccentVar(kind));
</script>

<a
  {href}
  class={cn(
    "group glass hover-lift relative grid grid-cols-[1fr_auto] items-center gap-4 overflow-hidden rounded-xl px-5 py-4 text-foreground no-underline shadow-rest",
    className,
  )}
  style="animation-delay: {delay}ms;"
>
  <span
    class="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
    style="background: {accent};"
    aria-hidden="true"
  ></span>

  <div class="min-w-0">
    <div class="truncate font-medium">{title}</div>
    <div
      class="mt-0.5 truncate text-caption font-mono uppercase tracking-wider text-muted-foreground"
    >
      {typeLabel}{context ? ` · ${context}` : ""}
    </div>
  </div>

  <div class="flex items-center gap-4">
    <div class="hidden flex-col items-end gap-1 sm:flex">
      <StatusPill {status} type={kind} />
      {#if timing || foot}
        <div
          class="flex items-center gap-2 font-mono text-caption tabular-nums text-muted-foreground"
        >
          {#if timing}<span>{@render timing()}</span>{/if}
          {#if timing && foot}<span class="opacity-40">·</span>{/if}
          {#if foot}<span>{@render foot()}</span>{/if}
        </div>
      {/if}
    </div>
    <ChevronRight
      class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
    />
  </div>
</a>
