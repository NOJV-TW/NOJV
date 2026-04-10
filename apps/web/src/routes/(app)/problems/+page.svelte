<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";
  import Section from "$lib/components/ui/Section.svelte";

  let { data } = $props();
</script>

<Section class="space-y-6">
  {#snippet header()}
    <h1 class="font-display text-title-lg">{m.navigation_problems()}</h1>
  {/snippet}

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
  />
</Section>
