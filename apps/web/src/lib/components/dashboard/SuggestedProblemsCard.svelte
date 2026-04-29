<script lang="ts">
  import { Lightbulb } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/ui/card";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  interface Suggestion {
    id: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
  }

  interface Props {
    problems: Suggestion[];
  }

  let { problems }: Props = $props();

  const difficultyColor: Record<"easy" | "medium" | "hard", string> = {
    easy: "bg-success/15 text-success",
    medium: "bg-warning/15 text-warning",
    hard: "bg-destructive/15 text-destructive",
  };
</script>

<Card variant="surface" size="lg">
  <h2 class="mb-4 text-title-sm font-semibold">
    {m.dashboard_suggestionsTitle()}
  </h2>
  {#if problems.length > 0}
    <ul class="flex flex-col divide-y divide-border-subtle">
      {#each problems as p (p.id)}
        <li class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
          <a
            class="text-body-sm font-medium hover:underline"
            href="/problems/{p.id}"
          >
            {p.title}
          </a>
          <span
            class="rounded-full px-2 py-0.5 text-micro font-medium capitalize {difficultyColor[
              p.difficulty
            ]}"
          >
            {p.difficulty}
          </span>
          {#if p.tags.length > 0}
            <span class="flex flex-wrap items-center gap-1">
              {#each p.tags.slice(0, 4) as tag (tag)}
                <span
                  class="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground"
                >
                  {tag}
                </span>
              {/each}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <EmptyState
      variant="minimal"
      icon={Lightbulb}
      title={m.dashboard_suggestionsEmpty()}
    />
  {/if}
</Card>
