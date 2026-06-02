<script lang="ts">
  import { Code2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import ProblemsTabs from "$lib/components/features/problem/views/ProblemTabs.svelte";

  let { data } = $props();
</script>

<PageContainer class="fade-up">
  <PageHeader
    eyebrow={m.problems_eyebrow()}
    title={m.navigation_problems()}
    description={m.problems_subtitle()}
  >
    {#snippet icon()}
      <Code2 class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
    {/snippet}
  </PageHeader>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
    loggedIn={data.loggedIn}
    advancedModeSupported={data.advancedModeSupported}
  />
</PageContainer>
