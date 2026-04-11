<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemSections from "$lib/components/problem/ProblemSections.svelte";
  import BasicInfoTab from "$lib/components/problem/tabs/BasicInfoTab.svelte";
  import TestcaseTab from "$lib/components/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/problem/tabs/JudgeTab.svelte";
  import WorkspaceSection from "$lib/components/problem/sections/WorkspaceSection.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

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
  // The workspace is a scratchpad the user edits before saving; capture the
  // initial values once via untrack() so re-runs of `data` don't discard edits.
  const workspaceInitial = untrack(() => {
    const runtime = (data.problem.judgeConfig?.runtime as
      | { timeLimitMs: number; memoryLimitMb: number; env: Record<string, string> }
      | undefined) ?? {
      timeLimitMs: data.problem.timeLimitMs,
      memoryLimitMb: data.problem.memoryLimitMb,
      env: {}
    };
    return {
      runtime,
      allowedLanguages: [] as Language[],
      files: data.workspaceFiles.map((f) => ({
        language: f.language as Language,
        path: f.path,
        content: f.content,
        description: f.description,
        visibility: f.visibility as "editable" | "readonly" | "hidden",
        orderIndex: f.orderIndex
      }))
    };
  });

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
    <h1 class="font-display text-title-lg">
      {data.problem.title === "Untitled Problem" ? m.admin_createProblem() : data.problem.title}
    </h1>
    {#if data.problem.status === "draft"}
      <Badge variant="warning" size="md">Draft</Badge>
    {/if}
    {#if data.problem.status === "draft"}
      <Button
        class="ml-auto"
        variant="outline"
        size="sm"
        disabled={deleting}
        onclick={() => (showDeleteConfirm = true)}
      >
        {deleting ? m.common_deleting() : m.common_delete()}
      </Button>
    {/if}
  </div>

  <ProblemSections
    bind:activeSection
    showPublish={data.problem.status === "draft"}
    showConvertToAdvanced={data.problem.type !== "special_env"}
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
