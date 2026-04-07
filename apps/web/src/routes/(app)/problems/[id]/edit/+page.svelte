<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";
  import SubmissionTab from "$lib/components/problem/tabs/SubmissionTab.svelte";
  import TestcaseTab from "$lib/components/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/problem/tabs/JudgeTab.svelte";
  import ScoringTab from "$lib/components/problem/tabs/ScoringTab.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  let { data } = $props();

  let activeTab = $state("basic");
  let publishing = $state(false);
  let dirty = $state(false);
  let showPublishConfirm = $state(false);

  // Publish requires: at least one testcase set
  let canPublish = $derived(
    data.problem.status === "draft" && data.testcaseSets.length > 0
  );

  let basicInfoComplete = $derived(
    data.problem.title !== "Untitled Problem" &&
    data.problem.statement !== "" &&
    data.problem.inputFormat !== "" &&
    data.problem.outputFormat !== ""
  );

  function handlePublishClick() {
    showPublishConfirm = true;
  }

  function handlePublishConfirmed() {
    showPublishConfirm = false;
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
      {data.problem.title === "Untitled Problem" ? m.admin_createProblem() : data.problem.title}
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
      {basicInfoComplete}
      bind:dirty
      onpublish={handlePublishClick}
    >
      {#snippet basic()}
        <BasicInfoTab formData={data.form} problemId={data.problem.id} ondirtychange={(d) => dirty = d} />
      {/snippet}

      {#snippet submission()}
        <SubmissionTab problem={data.problem} formData={data.form} ondirtychange={(d) => dirty = d} />
      {/snippet}

      {#snippet testcase()}
        <TestcaseTab testcaseSets={data.testcaseSets} problemId={data.problem.id} />
      {/snippet}

      {#snippet judge()}
        <JudgeTab problem={data.problem} ondirtychange={(d) => dirty = d} />
      {/snippet}

      {#snippet scoring()}
        <ScoringTab problem={data.problem} ondirtychange={(d) => dirty = d} />
      {/snippet}
    </ProblemTabs>
  </section>

  <ConfirmDialog
    bind:open={showPublishConfirm}
    title={m.admin_publishConfirmTitle()}
    message={m.admin_publishConfirmMessage()}
    confirmText={m.admin_publishConfirmButton()}
    cancelText={m.admin_cancel()}
    onconfirm={handlePublishConfirmed}
    oncancel={() => (showPublishConfirm = false)}
  />
</div>
