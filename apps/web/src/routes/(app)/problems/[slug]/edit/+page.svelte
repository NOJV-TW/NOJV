<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";
  import SubmissionTab from "$lib/components/problem/tabs/SubmissionTab.svelte";
  import TestcaseTab from "$lib/components/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/problem/tabs/JudgeTab.svelte";
  import ScoringTab from "$lib/components/problem/tabs/ScoringTab.svelte";

  let { data } = $props();

  let activeTab = $state("basic");
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problemDetail_editProblem()}: {data.problem.title}
  </h2>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <ProblemTabs bind:activeTab>
      {#snippet basic()}
        <BasicInfoTab problem={data.problem} formData={data.form} />
      {/snippet}

      {#snippet submission()}
        <SubmissionTab problem={data.problem} formData={data.form} />
      {/snippet}

      {#snippet testcase()}
        <TestcaseTab testcaseSets={data.testcaseSets} problemSlug={data.problem.slug} />
      {/snippet}

      {#snippet judge()}
        <JudgeTab problem={data.problem} />
      {/snippet}

      {#snippet scoring()}
        <ScoringTab problem={data.problem} />
      {/snippet}
    </ProblemTabs>
  </section>
</div>
