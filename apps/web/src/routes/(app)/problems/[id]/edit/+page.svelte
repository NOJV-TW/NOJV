<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";
  import SubmissionTab from "$lib/components/problem/tabs/SubmissionTab.svelte";
  import TestcaseTab from "$lib/components/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/problem/tabs/JudgeTab.svelte";
  import ScoringTab from "$lib/components/problem/tabs/ScoringTab.svelte";

  let { data } = $props();

  let activeTab = $state("basic");
  let publishing = $state(false);

  // Publish requires: at least one testcase set
  let canPublish = $derived(
    data.problem.status === "draft" && data.testcaseSets.length > 0
  );

  function handlePublish() {
    publishing = true;
    const fd = new FormData();
    fetch(`?/publish`, { method: "POST", body: fd }).then(async (res) => {
      if (res.ok) await invalidateAll();
      publishing = false;
    });
  }
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <div class="flex items-center gap-3">
    <h2 class="font-[family-name:var(--font-display)] text-3xl">
      {data.problem.title}
    </h2>
    {#if data.problem.status === "draft"}
      <span class="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        Draft
      </span>
    {/if}
  </div>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <ProblemTabs
      bind:activeTab
      showPublish={data.problem.status === "draft"}
      {canPublish}
      {publishing}
      onpublish={handlePublish}
    >
      {#snippet basic()}
        <BasicInfoTab formData={data.form} />
      {/snippet}

      {#snippet submission()}
        <SubmissionTab problem={data.problem} formData={data.form} />
      {/snippet}

      {#snippet testcase()}
        <TestcaseTab testcaseSets={data.testcaseSets} problemId={data.problem.id} />
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
