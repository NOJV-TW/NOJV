<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="font-[family-name:var(--font-display)] text-3xl">{m.navigation_problems()}</h2>
    {#if data.canCreate}
      <a
        href="/problems/create"
        class="inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
      >
        {m.admin_createProblem()}
      </a>
    {/if}
  </div>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
</div>
