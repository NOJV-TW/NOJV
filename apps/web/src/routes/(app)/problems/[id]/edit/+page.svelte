<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemSections from "$lib/components/problem/ProblemSections.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";
  import TestcaseTab from "$lib/components/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/problem/tabs/JudgeTab.svelte";
  import WorkspaceSection from "$lib/components/problem/sections/WorkspaceSection.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  let { data } = $props();

  let activeSection = $state("basic");
  let publishing = $state(false);
  let dirty = $state(false);
  let showPublishConfirm = $state(false);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);

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

  // Build WorkspaceSection initial payload from loaded problem + files.
  const runtime = (data.problem.judgeConfig?.runtime as
    | { timeLimitMs: number; memoryLimitMb: number; env: Record<string, string> }
    | undefined) ?? {
    timeLimitMs: data.problem.timeLimitMs,
    memoryLimitMb: data.problem.memoryLimitMb,
    env: {}
  };

  const workspaceInitial = {
    runtime,
    allowedLanguages: [] as Language[],
    files: data.workspaceFiles.map((f) => ({
      language: f.language as Language,
      path: f.path,
      content: f.content,
      visibility: f.visibility as "editable" | "readonly" | "hidden",
      editableRegions: (f.editableRegions as [number, number][] | null) ?? null,
      orderIndex: f.orderIndex
    }))
  };

  async function handleWorkspaceSave(payload: typeof workspaceInitial) {
    const fd = new FormData();
    fd.set("data", JSON.stringify(payload));
    const res = await fetch("?/updateWorkspace", { method: "POST", body: fd });
    if (!res.ok) throw new Error("workspace save failed");
    await invalidateAll();
  }

  function handlePublishClick() {
    showPublishConfirm = true;
  }

  function handleDeleteConfirmed() {
    showDeleteConfirm = false;
    deleting = true;
    const fd = new FormData();
    fetch(`?/deleteProblem`, { method: "POST", body: fd, redirect: "follow" }).then(() => {
      window.location.href = "/problems?tab=mine";
    }).catch(() => {
      deleting = false;
    });
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
    {#if data.problem.status === "draft"}
      <button
        class="ml-auto rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        disabled={deleting}
        type="button"
        onclick={() => (showDeleteConfirm = true)}
      >
        {deleting ? m.common_deleting() : m.common_delete()}
      </button>
    {/if}
  </div>

  <ProblemSections
    bind:activeSection
    showPublish={data.problem.status === "draft"}
    {canPublish}
    {publishing}
    {basicInfoComplete}
    testcaseCount={data.testcaseSets.length}
    bind:dirty
    onpublish={handlePublishClick}
  >
    {#snippet basic()}
      <BasicInfoTab formData={data.form} problemId={data.problem.id} ondirtychange={(d) => dirty = d} />
    {/snippet}

    {#snippet workspace()}
      <WorkspaceSection
        initial={workspaceInitial}
        ondirtychange={(d) => dirty = d}
        onsave={handleWorkspaceSave}
      />
    {/snippet}

    {#snippet testcase()}
      <TestcaseTab testcaseSets={data.testcaseSets} problemId={data.problem.id} />
    {/snippet}

    {#snippet judge()}
      <JudgeTab
        problem={data.problem}
        testcaseSets={data.testcaseSets.map((s) => ({ id: s.id, name: s.name, weight: s.weight }))}
        ondirtychange={(d) => dirty = d}
      />
    {/snippet}
  </ProblemSections>

  <ConfirmDialog
    bind:open={showDeleteConfirm}
    title={m.admin_deleteProblemTitle()}
    message={m.admin_deleteProblemMessage()}
    confirmText={m.common_delete()}
    cancelText={m.admin_cancel()}
    variant="danger"
    onconfirm={handleDeleteConfirmed}
    oncancel={() => (showDeleteConfirm = false)}
  />

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
