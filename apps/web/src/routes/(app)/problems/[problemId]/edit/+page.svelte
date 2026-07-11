<script lang="ts">
  import { untrack } from "svelte";
  import { deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import ProblemSections from "$lib/components/features/problem/views/ProblemSections.svelte";
  import EditRail from "$lib/components/features/problem/views/EditRail.svelte";
  import BasicInfoTab from "$lib/components/features/problem/tabs/BasicInfoTab.svelte";
  import TestcaseTab from "$lib/components/features/problem/tabs/TestcaseTab.svelte";
  import JudgeTab from "$lib/components/features/problem/tabs/JudgeTab.svelte";
  import WorkspaceSection from "$lib/components/features/problem/sections/WorkspaceSection.svelte";
  import AdvancedPackageSection from "$lib/components/features/problem/advanced/AdvancedPackageSection.svelte";
  import AdvancedImageConfigSection from "$lib/components/features/problem/advanced/AdvancedImageConfigSection.svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import BreadcrumbBackLink from "$lib/components/primitives/layout/BreadcrumbBackLink.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { toasts } from "$lib/stores/toast";

  let { data } = $props();

  let isAdvanced = $derived(data.problem.type === "special_env");

  let activeSection = $state("basic");
  let basicTab = $state<BasicInfoTab | null>(null);
  let workspaceTab = $state<WorkspaceSection | null>(null);
  let judgeTab = $state<JudgeTab | null>(null);
  let advancedSection = $state<AdvancedPackageSection | null>(null);
  let advancedUploadReady = $state(false);

  let activeSectionSavable = $derived(
    activeSection === "basic" || activeSection === "workspace" || activeSection === "judge",
  );

  function saveActiveSection() {
    if (activeSection === "basic") basicTab?.save();
    else if (activeSection === "workspace") workspaceTab?.save();
    else if (activeSection === "judge") judgeTab?.save();
  }
  let isPublishing = $state(false);
  let isDirty = $state(false);
  let showPublishConfirm = $state(false);
  let showDeleteConfirm = $state(false);
  let isDeleting = $state(false);

  let isBasicInfoComplete = $derived(
    data.problem.title.trim() !== "" &&
      data.problem.title !== "Untitled Problem" &&
      data.problem.statement !== "" &&
      data.problem.inputFormat !== "" &&
      data.problem.outputFormat !== "",
  );

  let missingBasicFields = $derived(
    [
      data.problem.title === "Untitled Problem" || data.problem.title.trim() === ""
        ? m.admin_title()
        : null,
      data.problem.statement === "" ? m.admin_statement() : null,
      data.problem.inputFormat === "" ? m.admin_inputFormat() : null,
      data.problem.outputFormat === "" ? m.admin_outputFormat() : null,
    ].filter((label): label is NonNullable<typeof label> => label !== null),
  );

  let canPublish = $derived(
    data.problem.status === "draft" &&
      (isAdvanced
        ? (data.advancedConfig?.config?.run.imageRef ?? "") !== "" &&
          (data.advancedConfig?.config?.grade.imageRef ?? "") !== "" &&
          data.advancedJudgeVerified
        : data.testcaseSets.length > 0),
  );

  const workspaceInitial = untrack(() => {
    if (data.problem.type !== "multi_file") return undefined;
    const runtime = (data.problem.judgeConfig?.runtime as
      | { timeLimitMs: number; memoryLimitMb: number; env: Record<string, string> }
      | undefined) ?? {
      timeLimitMs: data.problem.timeLimitMs,
      memoryLimitMb: data.problem.memoryLimitMb,
      env: {},
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
        orderIndex: f.orderIndex,
      })),
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
    const res = await fetch(`/api/problems/${data.problem.id}/workspace/files`, {
      method: "POST",
      headers: { "X-Requested-With": "fetch" },
      body: fd,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? m.bundle_uploadFailed());
    }
    toasts.add({ message: m.bundle_uploadSuccess(), type: "success" });
    await invalidateAll();
  }

  function handlePublishClick() {
    showPublishConfirm = true;
  }

  function handleDeleteConfirmed() {
    showDeleteConfirm = false;
    isDeleting = true;
    const fd = new FormData();
    fetch(`?/deleteProblem`, { method: "POST", body: fd, redirect: "follow" })
      .then(async (res) => {
        if (res.ok) {
          window.location.href = "/problems?tab=mine";
          return;
        }
        const result = deserialize(await res.text());
        toasts.error(
          result.type === "failure" && typeof result.data?.error === "string"
            ? result.data.error
            : m.error_unexpected(),
        );
        isDeleting = false;
      })
      .catch(() => {
        toasts.error(m.error_unexpected());
        isDeleting = false;
      });
  }

  function handlePublishConfirmed() {
    showPublishConfirm = false;
    isPublishing = true;
    const fd = new FormData();
    fetch(`?/publish`, { method: "POST", body: fd })
      .then(async (res) => {
        if (res.ok) {
          await invalidateAll();
          toasts.success(m.admin_publishSuccess());
        } else {
          const result = deserialize(await res.text());
          toasts.error(
            result.type === "failure" && typeof result.data?.error === "string"
              ? result.data.error
              : m.error_unexpected(),
          );
        }
      })
      .catch(() => {
        toasts.error(m.error_unexpected());
      })
      .finally(() => {
        isPublishing = false;
      });
  }

  async function handleAdvancedPackageUploaded() {
    toasts.add({ message: m.bundle_uploadSuccess(), type: "success" });
    await invalidateAll();
  }

  let advancedConfigured = $derived(
    (data.advancedConfig?.config?.run.imageRef ?? "") !== "" &&
      (data.advancedConfig?.config?.grade.imageRef ?? "") !== "",
  );

  let advancedSteps = $derived([
    { label: m.advancedImages_stepBasic(), done: isBasicInfoComplete },
    { label: m.advancedImages_stepImages(), done: advancedConfigured },
    { label: m.advancedImages_stepTest(), done: data.advancedJudgeVerified },
    { label: m.admin_publishProblem(), done: data.problem.status !== "draft" },
  ]);
</script>

<PageContainer class="space-y-6">
  <BreadcrumbBackLink href="/problems?tab=mine" label={m.problems_myProblems()} />

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
  </div>

  {#if isAdvanced}
    {#snippet advancedActions()}
      <Button
        variant="outline"
        size="sm"
        class="w-full"
        disabled={!isDirty}
        onclick={() => basicTab?.save()}
      >
        {m.common_saveDraft()}
      </Button>
      {#if data.advancedZipUploadEnabled}
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          disabled={!advancedUploadReady}
          onclick={() => advancedSection?.save()}
        >
          {m.advancedPackage_uploadPackage()}
        </Button>
      {/if}
      {#if data.problem.status === "draft"}
        <Button
          size="sm"
          class="w-full"
          loading={isPublishing}
          disabled={!canPublish || isPublishing}
          onclick={handlePublishClick}
        >
          {isPublishing ? m.admin_publishingProblem() : m.admin_publishProblem()}
        </Button>
        {#if !canPublish}
          <p class="px-1 text-micro leading-relaxed text-muted-foreground">
            {m.admin_advancedPublishHint()}
          </p>
        {/if}
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          loading={isDeleting}
          disabled={isDeleting}
          onclick={() => (showDeleteConfirm = true)}
        >
          {isDeleting ? m.common_deleting() : m.admin_deleteProblemTitle()}
        </Button>
      {/if}
    {/snippet}
    <div class="flex gap-6">
      <EditRail actions={advancedActions}>
        {#snippet nav()}
          <ol class="space-y-1">
            {#each advancedSteps as step, i (step.label)}
              <li
                class="flex items-center gap-2 rounded-md px-3 py-2 text-body-sm font-medium text-muted-foreground"
              >
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-caption font-semibold text-primary"
                >
                  {i + 1}
                </span>
                <span class="flex-1">{step.label}</span>
                {#if step.done}
                  <span class="text-caption text-muted-foreground">✓</span>
                {/if}
              </li>
            {/each}
          </ol>
          <div class="mt-3 flex flex-col gap-1 border-t border-border-subtle pt-3">
            {#if data.advancedZipUploadEnabled}
              <a
                class="rounded-md px-3 py-1.5 text-caption font-medium text-muted-foreground transition-[background-color,color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                href="/api/problems/advanced-scaffold"
              >
                {m.advancedPackage_stepTemplateTitle()}
              </a>
            {/if}
            <a
              class="rounded-md px-3 py-1.5 text-caption font-medium text-muted-foreground transition-[background-color,color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
              href="/guides/advanced-mode"
            >
              {m.advancedPackage_guide()}
            </a>
          </div>
        {/snippet}
      </EditRail>

      <div class="min-w-0 flex-1 space-y-6">
        <section
          class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
        >
          <BasicInfoTab
            bind:this={basicTab}
            formData={data.form}
            problemId={data.problem.id}
            showRuntimeLimits={true}
            ondirtychange={(d) => (isDirty = d)}
          />
        </section>

        <section
          class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
        >
          <AdvancedImageConfigSection
            config={data.advancedConfig?.config ?? null}
            allowedRegistries={data.advancedAllowedRegistries}
          />
        </section>

        {#if data.advancedZipUploadEnabled && data.advancedConfig}
          <section
            class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
          >
            <AdvancedPackageSection
              bind:this={advancedSection}
              bind:uploadReady={advancedUploadReady}
              problemId={data.problem.id}
              config={data.advancedConfig.config}
              onuploaded={handleAdvancedPackageUploaded}
            />
          </section>
        {/if}
      </div>
    </div>
  {:else}
    <ProblemSections
      bind:activeSection
      problemType={data.problem.type}
      showConvertToAdvanced={true}
      convertToAdvancedAllowed={data.advancedCreationAllowed}
      {isBasicInfoComplete}
      {missingBasicFields}
      testcaseCount={data.testcaseSets.length}
      bind:isDirty
    >
      {#snippet railActions()}
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          disabled={!isDirty || !activeSectionSavable}
          onclick={saveActiveSection}
        >
          {m.common_saveDraft()}
        </Button>
        {#if data.problem.status === "draft"}
          <Button
            size="sm"
            class="w-full"
            loading={isPublishing}
            disabled={!canPublish || isPublishing}
            onclick={handlePublishClick}
            data-tour="problem-publish"
          >
            {isPublishing ? m.admin_publishingProblem() : m.admin_publishProblem()}
          </Button>
          {#if !canPublish}
            <p class="px-1 text-micro leading-relaxed text-muted-foreground">
              {m.admin_publishTooltip()}
            </p>
          {/if}
        {/if}
      {/snippet}

      {#snippet dangerActions()}
        {#if data.problem.status === "draft"}
          <Button
            variant="outline"
            size="sm"
            class="w-full"
            loading={isDeleting}
            disabled={isDeleting}
            onclick={() => (showDeleteConfirm = true)}
          >
            {isDeleting ? m.common_deleting() : m.admin_deleteProblemTitle()}
          </Button>
        {/if}
      {/snippet}

      {#snippet basic()}
        <BasicInfoTab
          bind:this={basicTab}
          formData={data.form}
          problemId={data.problem.id}
          showRuntimeLimits={data.problem.type !== "multi_file"}
          ondirtychange={(d) => (isDirty = d)}
        />
      {/snippet}

      {#snippet workspace()}
        {#if workspaceInitial}
          <WorkspaceSection
            bind:this={workspaceTab}
            initial={workspaceInitial}
            ondirtychange={(d) => (isDirty = d)}
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
          bind:this={judgeTab}
          problem={data.problem}
          validatorScripts={data.validatorScripts}
          ondirtychange={(d) => (isDirty = d)}
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
</PageContainer>
