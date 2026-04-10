<script lang="ts">
  import { Code2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/ui/Section.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
</script>

<Section>
  {#snippet header()}
    <h1 class="font-display text-title-lg">{m.navigation_submissions()}</h1>
    <p>{m.submissions_workspaceHint()}</p>
  {/snippet}

  <EmptyState
    variant="onboarding"
    icon={Code2}
    title={m.submissions_empty()}
    description={m.submissions_emptyHint()}
    actions={[
      {
        href: "/problems",
        label: m.submissions_browseCta(),
        variant: "default",
      },
    ]}
  />
</Section>
