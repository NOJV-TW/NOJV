<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{m.navigation_problems()}</h2>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicProblems={data.publicProblems}
    showCreate={data.showCreate}
    solvedSlugs={data.solvedSlugs}
  />
</div>
