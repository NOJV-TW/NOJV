<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/layout/PageHeader.svelte";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";

  let { data } = $props();
</script>

<PageContainer>
  <PageHeader
    eyebrow={m.problems_eyebrow()}
    title={m.navigation_problems()}
    description={m.problems_subtitle()}
  />

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
  />
</PageContainer>
