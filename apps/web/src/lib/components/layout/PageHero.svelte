<script lang="ts">
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";
  import BreadcrumbBackLink from "./BreadcrumbBackLink.svelte";

  interface Props {
    variant?: "hub" | "workspace";
    breadcrumbHref: string;
    breadcrumbLabel: string;
    eyebrow?: string | undefined;
    title: string;
    meta?: Snippet | undefined;
    actions?: Snippet | undefined;
    ribbon?: Snippet | undefined;
    class?: string | undefined;
  }

  let {
    variant = "workspace",
    breadcrumbHref,
    breadcrumbLabel,
    eyebrow,
    title,
    meta,
    actions,
    ribbon,
    class: className
  }: Props = $props();
</script>

<section
  data-slot="page-hero"
  data-variant={variant}
  class={cn(
    "animate-in border-b border-border",
    variant === "hub" ? "pb-7 pt-8" : "pb-9 pt-2",
    className
  )}
>
  <BreadcrumbBackLink href={breadcrumbHref} label={breadcrumbLabel} />

  <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      {#if eyebrow}
        <p
          class="text-caption font-semibold uppercase tracking-[0.12em] text-primary"
        >
          {eyebrow}
        </p>
      {/if}
      <h1
        class={cn(
          "text-display font-normal leading-none tracking-[-0.025em]",
          eyebrow ? "mt-2" : ""
        )}
      >
        {title}
      </h1>
      {#if meta}
        <div
          class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-muted-foreground"
        >
          {@render meta()}
        </div>
      {/if}
    </div>
    {#if actions}
      <div class="flex shrink-0 items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if ribbon}
    <div class="mt-8">
      {@render ribbon()}
    </div>
  {/if}
</section>
