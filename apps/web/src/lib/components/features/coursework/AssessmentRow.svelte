<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronRight } from "@lucide/svelte";
  import { cn } from "$lib/utils/css.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
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
    dateIso?: string | null;
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
    dateIso,
    timing,
    foot,
    delay = 0,
    class: className,
  }: Props = $props();

  const accent = $derived(typeAccentVar(kind));

  const dateParts = $derived.by(() => {
    if (!dateIso) return null;
    const d = new Date(dateIso);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return {
      month: new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(d),
      day: pad2(d.getDate()),
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  });
</script>

<a
  {href}
  class={cn(
    "group glass hover-lift relative grid items-center gap-4 overflow-hidden rounded-xl px-5 py-4 text-foreground no-underline shadow-rest",
    dateParts ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]",
    className,
  )}
  style="animation-delay: {delay}ms;"
>
  <span
    class="pointer-events-none absolute inset-y-0 left-0 w-1.5"
    style="background: {accent};"
    aria-hidden="true"
  ></span>

  {#if dateParts}
    <div
      class="flex min-w-[3rem] flex-col items-center justify-center rounded-md border border-border bg-[color:var(--color-panel)]/60 px-2 py-1 text-center leading-none"
    >
      <span class="text-micro font-semibold uppercase tracking-[0.08em] text-primary">
        {dateParts.month}
      </span>
      <span class="mt-0.5 text-title-sm font-semibold tabular-nums">{dateParts.day}</span>
      <span class="mt-1 font-mono text-micro tabular-nums text-muted-foreground">
        {dateParts.time}
      </span>
    </div>
  {/if}

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
