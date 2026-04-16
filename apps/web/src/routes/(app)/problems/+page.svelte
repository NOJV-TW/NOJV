<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";

  let { data } = $props();
</script>

<div class="pb-24">
  <header class="animate-in mb-8">
    <h1 class="font-display text-display font-medium tracking-[-0.02em]">
      {m.navigation_problems()}
    </h1>
    <p class="mt-2 text-body text-muted-foreground">
      {m.problems_subtitle()}
    </p>
  </header>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
  />
</div>
