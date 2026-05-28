<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { Language, ProblemImageSource } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import ProblemSections from "$lib/components/features/problem/views/ProblemSections.svelte";
  import BasicInfoTab from "$lib/components/features/problem/tabs/BasicInfoTab.svelte";
  import TestcaseTab from "$lib/components/features/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/features/problem/tabs/JudgeTab.svelte";
  import WorkspaceSection from "$lib/components/features/problem/sections/WorkspaceSection.svelte";
  import ImageSection from "$lib/components/features/problem/advanced/ImageSection.svelte";
  import ContainerContractSection from "$lib/components/features/problem/advanced/ContainerContractSection.svelte";
  import RequiredPathsSection from "$lib/components/features/problem/advanced/RequiredPathsSection.svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import BundleControls from "$lib/components/features/problem/admin/BundleControls.svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import { toasts } from "$lib/stores/toast";

  let { data } = $props();

  let isAdvanced = $derived(data.problem.type === "special_env");

  let activeSection = $state("basic");
  let isPublishing = $state(false);
  let isDirty = $state(false);
  let showPublishConfirm = $state(false);
  let showDeleteConfirm = $state(false);
  let showRejudgeDialog = $state(false);
  let isDeleting = $state(false);

  // Bumped on every successful upload (bundle import, checker/interactor
  // script, workspace file). StorageBudgetBar watches this token and refetches
  // usage when it changes so the bar never lags behind the actual budget.
  let storageRefreshToken = $state(0);
  function bumpStorageRefresh() {
    storageRefreshToken += 1;
  }

  // Advanced-mode image config — only meaningful when isAdvanced is true.
  // Initialised once via untrack so re-runs of `data` don't clobber edits.
  let imageRef = $state<string>(untrack(() => data.imageConfig?.ref ?? ""));
  let imageSource = $state<ProblemImageSource>(
    untrack(() => data.imageConfig?.source ?? "registry")
  );
  let advancedTimeLimitMs = $state<number>(
    untrack(() => data.imageConfig?.timeLimitMs ?? 30_000)
  );
  let advancedMemoryLimitMb = $state<number>(
    untrack(() => data.imageConfig?.memoryLimitMb ?? 1_024)
  );

  // Advanced-mode required paths — persists separately from the image config.
  let requiredPaths = $state<string[]>(
    untrack(() => data.problem.advancedRequiredPaths ?? [])
  );

  let isBasicInfoComplete = $derived(
    data.problem.title !== "Untitled Problem" &&
    data.problem.statement !== "" &&
    data.problem.inputFormat !== "" &&
    data.problem.outputFormat !== ""
  );

  // Publish gate: standard problems need at least one testcase set; advanced
  // problems have none, so they need basic info complete + a judge image set.
  let canPublish = $derived(
    data.problem.status === "draft" &&
    (isAdvanced
      ? isBasicInfoComplete && (data.imageConfig?.ref ?? "") !== ""
      : data.testcaseSets.length > 0)
  );

  // Build WorkspaceSection initial payload from loaded problem + files.
  // The workspace is a scratchpad the user edits before saving; capture the
  // initial values once via untrack() so re-runs of `data` don't discard edits.
  // Only consumed by `multi_file` problems — full_source uses system templates
  // and advanced mode routes to its own layout.
  const workspaceInitial = untrack(() => {
    if (data.problem.type !== "multi_file") return undefined;
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
      type: "multi_file" as "full_source" | "multi_file",
      files: data.workspaceFiles.map((f) => ({
        language: f.language,
        path: f.path,
        content: f.content,
        description: f.description,
        visibility: f.visibility,
        orderIndex: f.orderIndex
      }))
    };
  });

  async function handleWorkspaceSave(payload: NonNullable<typeof workspaceInitial>) {
    const fd = new FormData();
    fd.set("data", JSON.stringify(payload));
    const res = await fetch("?/updateWorkspace", { method: "POST", body: fd });
    if (!res.ok) throw new Error("workspace save failed");
    await invalidateAll();
  }

  async function handleWorkspaceFileUpload(file: File, language: Language) {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("language", language);
    fd.set("path", file.name);
    fd.set("visibility", "editable");
    const res = await fetch(
      `/api/problems/${data.problem.id}/workspace/files`,
      {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
        body: fd
      }
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? m.bundle_uploadFailed());
    }
    toasts.add({ message: m.bundle_uploadSuccess(), type: "success" });
    bumpStorageRefresh();
    await invalidateAll();
  }

  function handlePublishClick() {
    showPublishConfirm = true;
  }

  function handleDeleteConfirmed() {
    showDeleteConfirm = false;
    isDeleting = true;
    const fd = new FormData();
    fetch(`?/deleteProblem`, { method: "POST", body: fd, redirect: "follow" }).then(() => {
      window.location.href = "/problems?tab=mine";
    }).catch(() => {
      isDeleting = false;
    });
  }

  function handlePublishConfirmed() {
    showPublishConfirm = false;
    isPublishing = true;
    const fd = new FormData();
    fetch(`?/publish`, { method: "POST", body: fd }).then(async (res) => {
      if (res.ok) await invalidateAll();
      isPublishing = false;
    });
  }

  async function saveImage(payload: {
    imageRef: string;
    imageSource: ProblemImageSource;
    timeLimitMs: number;
    memoryLimitMb: number;
  }): Promise<{ ok: boolean }> {
    const fd = new FormData();
    fd.append(
      "data",
      JSON.stringify({
        ref: payload.imageRef,
        source: payload.imageSource,
        timeLimitMs: payload.timeLimitMs,
        memoryLimitMb: payload.memoryLimitMb
      })
    );
    const res = await fetch("?/updateImage", { method: "POST", body: fd });
    // Success surfaces as a toast; failures render inline inside ImageSection.
    if (res.ok) {
      toasts.add({ message: m.admin_imageConfigSaved(), type: "success" });
    }
    return { ok: res.ok };
  }

  async function saveRequiredPaths() {
    const fd = new FormData();
    fd.append("data", JSON.stringify({ paths: requiredPaths }));
    const res = await fetch("?/updateRequiredPaths", { method: "POST", body: fd });
    toasts.add({
      message: res.ok
        ? m.advancedRequiredPaths_savedToast()
        : m.advancedRequiredPaths_saveFailedToast(),
      type: res.ok ? "success" : "error"
    });
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <h1 class="text-title-lg">
      {formatProblemDisplayName({
        displayId: data.problem.displayId,
        title:
          data.problem.title === "Untitled Problem"
            ? m.admin_createProblem()
            : data.problem.title,
      })}
    </h1>
    {#if data.problem.status === "draft"}
      <Badge variant="warning" size="md">{m.admin_draftBadge()}</Badge>
    {/if}
    {#if isAdvanced}
      <h2
        class="inline-flex items-center rounded-full border border-info/25 bg-info/15 px-2.5 py-1 text-caption font-medium text-info"
      >
        {m.admin_advancedMode()}
      </h2>
    {/if}
    <div class="ml-auto flex items-center gap-2">
      {#if data.problem.status !== "draft"}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (showRejudgeDialog = true)}
        >
          {m.rejudge_problem_admin_button()}
        </Button>
      {/if}
      {#if data.problem.status === "draft"}
        <Button
          variant="outline"
          size="sm"
          disabled={isDeleting}
          onclick={() => (showDeleteConfirm = true)}
        >
          {isDeleting ? m.common_deleting() : m.common_delete()}
        </Button>
      {/if}
      {#if isAdvanced && data.problem.status === "draft"}
        <Button
          size="sm"
          disabled={!canPublish || isPublishing}
          title={canPublish ? undefined : m.admin_advancedPublishHint()}
          onclick={handlePublishClick}
        >
          {isPublishing ? m.admin_publishingProblem() : m.admin_publishProblem()}
        </Button>
      {/if}
    </div>
  </div>

  <BundleControls
    problemId={data.problem.id}
    refreshToken={storageRefreshToken}
    onuploaded={bumpStorageRefresh}
  />

  {#if isAdvanced}
    <section class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest">
      <BasicInfoTab formData={data.form} problemId={data.problem.id} />
    </section>

    <section class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest">
      <ContainerContractSection />
    </section>

    <section class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest">
      <ImageSection
        problemId={data.problem.id}
        bind:imageRef
        bind:imageSource
        bind:timeLimitMs={advancedTimeLimitMs}
        bind:memoryLimitMb={advancedMemoryLimitMb}
        onsave={saveImage}
      />
    </section>

    <section class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest">
      <RequiredPathsSection
        value={requiredPaths}
        onchange={(next) => (requiredPaths = next)}
        onsave={saveRequiredPaths}
      />
    </section>
  {:else}
    <ProblemSections
      bind:activeSection
      problemType={data.problem.type}
      showPublish={data.problem.status === "draft"}
      showConvertToAdvanced={data.advancedModeSupported}
      {canPublish}
      {isPublishing}
      {isBasicInfoComplete}
      testcaseCount={data.testcaseSets.length}
      bind:isDirty
      onpublish={handlePublishClick}
    >
      {#snippet basic()}
        <BasicInfoTab formData={data.form} problemId={data.problem.id} ondirtychange={(d) => isDirty = d} />
      {/snippet}

      {#snippet workspace()}
        {#if workspaceInitial}
          <WorkspaceSection
            initial={workspaceInitial}
            ondirtychange={(d) => isDirty = d}
            onsave={handleWorkspaceSave}
            onUploadFile={handleWorkspaceFileUpload}
          />
        {/if}
      {/snippet}

      {#snippet testcase()}
        <TestcaseTab testcaseSets={data.testcaseSets} problemId={data.problem.id} />
      {/snippet}

      {#snippet judge()}
        <JudgeTab
          problem={data.problem}
          validatorScripts={data.validatorScripts}
          ondirtychange={(d) => isDirty = d}
          onuploaded={bumpStorageRefresh}
        />
      {/snippet}
    </ProblemSections>
  {/if}

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

  <RejudgeDialog
    problemId={data.problem.id}
    open={showRejudgeDialog}
    onOpenChange={(v) => (showRejudgeDialog = v)}
  />
</div>
