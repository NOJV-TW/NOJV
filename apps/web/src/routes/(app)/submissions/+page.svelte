<script lang="ts">
  import { Code2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { formatDateTime } from "$lib/utils/datetime";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";

  let { data } = $props();
</script>

<Section>
  {#snippet header()}
    <h1 class="text-title-lg">{m.navigation_submissions()}</h1>
    <p>{m.submissions_workspaceHint()}</p>
  {/snippet}

  {#if data.submissions.length === 0}
    <EmptyState
      variant="onboarding"
      icon={Code2}
      title={m.submissions_empty()}
      description={m.submissions_emptyHint()}
      actions={[
        {
          href: "/problems",
          label: m.submissions_browseCta(),
          variant: "default"
        }
      ]}
    />
  {:else}
    <div class="grid gap-2">
      {#each data.submissions as sub (sub.id)}
        <a
          class="rounded-md border border-border-subtle px-4 py-3 transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent hover:shadow-rest"
          href="/problems/{sub.problemId}"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="truncate text-body-sm font-semibold text-foreground">
              {sub.problemTitle}
            </span>
            <span class="shrink-0 text-caption text-muted-foreground tabular-nums">
              {formatDateTime(sub.createdAt)}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
            <VerdictBadge verdict={sub.status} />
            <span>{sub.language}</span>
            <span class="tabular-nums">{sub.score}/100</span>
            {#if sub.runtimeMs && sub.runtimeMs > 0}
              <span class="tabular-nums">{sub.runtimeMs} ms</span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</Section>
