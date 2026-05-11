<script lang="ts" module>
  export interface PageHeroMeta {
    k: string;
    v: string;
  }
</script>

<script lang="ts">
  import type { CourseworkKind } from "./StatusPill.svelte";
  import DotGrid from "./DotGrid.svelte";
  import CornerMark from "./CornerMark.svelte";
  import TypeIcon from "./TypeIcon.svelte";

  interface Props {
    kind: CourseworkKind;
    eyebrow: string;
    title: string;
    titleEn: string;
    description?: string;
    meta?: PageHeroMeta[];
    accentStripe?: boolean;
  }

  let {
    kind,
    eyebrow,
    title,
    titleEn,
    description,
    meta = [],
    accentStripe = false
  }: Props = $props();
</script>

<div class="relative overflow-hidden glass rounded-2xl shadow-rest p-7 lg:p-9">
  {#if kind === "assignment"}
    <DotGrid opacity={0.16} />
  {:else if kind === "exam"}
    <DotGrid opacity={0.12} />
    <CornerMark pos="tl" />
    <CornerMark pos="tr" />
    <CornerMark pos="bl" />
    <CornerMark pos="br" />
  {:else if kind === "contest"}
    <div
      class="pointer-events-none absolute inset-0 opacity-[0.07]"
      style="background: repeating-linear-gradient(135deg, var(--foreground) 0 1px, transparent 1px 22px);"
    ></div>
  {/if}

  {#if accentStripe}
    <div
      class="pointer-events-none absolute top-0 left-0 h-full w-1.5"
      style="background: var(--primary);"
    ></div>
  {/if}

  <div class="relative">
    <div
      class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground"
    >
      <TypeIcon {kind} size={14} />
      <span>{eyebrow}</span>
    </div>
    <div class="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 justify-between">
      <div class="min-w-0">
        <h1
          class="font-display font-semibold tracking-tight"
          style="font-size: clamp(2.25rem, 4.6vw, 3.5rem); line-height: 1.05;"
        >
          {title}
        </h1>
        <p
          class="mt-1 font-mono text-caption uppercase tracking-[0.18em] text-muted-foreground"
        >
          {titleEn}
        </p>
      </div>
      {#if meta.length > 0}
        <div class="flex gap-7 lg:gap-10">
          {#each meta as m, i (i)}
            <div>
              <div
                class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
              >
                {m.k}
              </div>
              <div class="mt-1 font-display text-title font-semibold tabular-nums">
                {m.v}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {#if description}
      <p class="mt-4 max-w-2xl text-body text-muted-foreground">{description}</p>
    {/if}
  </div>
</div>
