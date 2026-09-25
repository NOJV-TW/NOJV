<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import ProblemsTabs from "$lib/components/features/problem/views/ProblemTabs.svelte";

  let { data } = $props();
</script>

<PageContainer class="fade-up">
  <PageHeader title={m.navigation_problems()} />

  <ProblemsTabs
    editableProblems={data.editableProblems}
    adminProblems={data.adminProblems}
    publicResult={data.publicResult}
    showCreate={data.canCreate}
    loggedIn={data.loggedIn}
    advancedCreationAllowed={data.advancedCreationAllowed}
    canFork={data.canFork}
    isAdmin={data.isAdmin}
  />
</PageContainer>
