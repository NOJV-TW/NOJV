<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ProblemType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Tooltip } from "bits-ui";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import * as Dialog from "$lib/components/ui/dialog";

  interface Props {
    activeSection?: string;
    problemType: ProblemType;
    canPublish?: boolean;
    showPublish?: boolean;
    publishing?: boolean;
    basicInfoComplete?: boolean;
    dirty?: boolean;
    testcaseCount?: number;
    showConvertToAdvanced?: boolean;
    onpublish?: () => void;
    basic?: Snippet;
    workspace?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
  }

  let {
    activeSection = $bindable("basic"),
    problemType,
    canPublish = false,
    showPublish = false,
    publishing = false,
    basicInfoComplete = false,
    dirty = $bindable(false),
    testcaseCount = 0,
    showConvertToAdvanced = false,
    onpublish,
    basic,
    workspace,
    testcase,
    judge,
  }: Props = $props();

  let showUnsavedModal = $state(false);
  let pendingSection = $state<string | null>(null);
  let showConvertModal = $state(false);
  let convertConfirmText = $state("");
  let convertFormEl = $state<HTMLFormElement | null>(null);
  let converting = $state(false);

  function openConvertModal() {
    convertConfirmText = "";
    showConvertModal = true;
  }

  function cancelConvert() {
    showConvertModal = false;
    convertConfirmText = "";
  }

  function submitConvert() {
    if (convertConfirmText !== "CONVERT") return;
    converting = true;
    convertFormEl?.submit();
  }

  const sections = $derived<{ id: string; label: string; icon: string }[]>([
    { id: "basic", label: m.admin_tabBasicInfo(), icon: "📝" },
    ...(problemType === "multi_file"
      ? [{ id: "workspace", label: m.admin_tabWorkspace(), icon: "💻" }]
      : []),
    { id: "testcase", label: m.admin_tabTestcase(), icon: "🧪" },
    { id: "judge", label: m.admin_tabJudge(), icon: "⚖️" },
  ]);

  $effect(() => {
    if (!sections.some((s) => s.id === activeSection)) {
      activeSection = "basic";
    }
  });

  function handleSectionClick(id: string) {
    if (id === activeSection) return;
    if (dirty) {
      pendingSection = id;
      showUnsavedModal = true;
    } else {
      activeSection = id;
    }
  }

  function confirmSwitch() {
    showUnsavedModal = false;
    dirty = false;
    if (pendingSection) {
      activeSection = pendingSection;
      pendingSection = null;
    }
  }

  function cancelSwitch() {
    showUnsavedModal = false;
    pendingSection = null;
  }

  function isLocked(id: string): boolean {
    return id !== "basic" && !basicInfoComplete;
  }

  function statusBadge(id: string): string {
    if (isLocked(id)) return "○";
    if (id === "basic") return basicInfoComplete ? "✓" : "●";
    if (id === "testcase") return testcaseCount > 0 ? "✓" : "○";
    return "✓";
  }
</script>

<div class="flex gap-6">
  <!-- Left nav -->
  <nav class="w-52 shrink-0 rounded-2xl border border-border bg-[color:var(--color-panel)] p-2 shadow-rest">
    <ul class="space-y-1">
      {#each sections as section (section.id)}
        {@const locked = isLocked(section.id)}
        <li>
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
              <Tooltip.Trigger
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft
                  {locked
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : activeSection === section.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                onclick={() => { if (!locked) handleSectionClick(section.id); }}
                type="button"
                disabled={locked}
              >
                <span class="text-body">{section.icon}</span>
                <span class="flex-1 text-left">{section.label}</span>
                <span class="text-caption text-muted-foreground">{statusBadge(section.id)}</span>
              </Tooltip.Trigger>
              {#if locked}
                <Tooltip.Portal>
                  <Tooltip.Content
                    class="z-50 max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-hover"
                    sideOffset={4}
                  >
                    {m.admin_tabLocked()}
                    <Tooltip.Arrow class="fill-popover stroke-border" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              {/if}
            </Tooltip.Root>
          </Tooltip.Provider>
        </li>
      {/each}
    </ul>

    {#if showPublish}
      <div class="mt-4 border-t border-border-subtle pt-4">
        {#if canPublish}
          <button
            class="w-full rounded-full bg-success px-4 py-2 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={publishing}
            type="button"
            onclick={() => onpublish?.()}
          >
            {publishing ? m.admin_publishingProblem() : m.admin_publishProblem()}
          </button>
        {:else}
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
              <Tooltip.Trigger
                class="w-full cursor-not-allowed rounded-full bg-muted px-4 py-2 text-caption font-semibold text-muted-foreground/50"
                type="button"
                onclick={(e: MouseEvent) => e.preventDefault()}
              >
                {m.admin_publishProblem()}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  class="z-50 max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-hover"
                  sideOffset={4}
                >
                  {m.admin_publishTooltip()}
                  <Tooltip.Arrow class="fill-popover stroke-border" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        {/if}
      </div>
    {/if}

    {#if showConvertToAdvanced}
      <div class="mt-6 border-t border-border-subtle pt-4">
        <p class="mb-2 text-micro leading-relaxed text-muted-foreground">
          {m.admin_convertToAdvancedHint()}
        </p>
        <p class="mb-3 text-micro leading-relaxed text-warning">
          {m.admin_convertToAdvancedInlineWarning()}
        </p>
        <button
          class="w-full rounded-full border border-border px-4 py-2 text-caption font-medium text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:border-warning hover:text-warning disabled:cursor-not-allowed disabled:opacity-60"
          disabled={converting}
          type="button"
          onclick={openConvertModal}
        >
          {converting ? m.admin_convertToAdvancedConverting() : m.admin_convertToAdvanced()}
        </button>
      </div>
    {/if}
  </nav>

  <!-- Main content -->
  <div class="min-w-0 flex-1">
    {#if activeSection === "basic" && basic}
      {@render basic()}
    {:else if activeSection === "workspace" && workspace}
      {@render workspace()}
    {:else if activeSection === "testcase" && testcase}
      {@render testcase()}
    {:else if activeSection === "judge" && judge}
      {@render judge()}
    {/if}
  </div>

  <ConfirmDialog
    bind:open={showUnsavedModal}
    title={m.admin_unsavedChangesTitle()}
    message={m.admin_unsavedChangesMessage()}
    confirmText={m.admin_unsavedLeave()}
    cancelText={m.admin_unsavedStay()}
    onconfirm={confirmSwitch}
    oncancel={cancelSwitch}
  />

  {#if showConvertToAdvanced}
    <Dialog.Root bind:open={showConvertModal}>
      <Dialog.Content showCloseButton>
        <Dialog.Header>
          <Dialog.Title>{m.admin_convertToAdvanced()}</Dialog.Title>
        </Dialog.Header>
        <div class="space-y-3 text-body-sm">
          <p class="text-muted-foreground">
            {m.admin_convertToAdvancedDesc()}
          </p>
          <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption text-warning">
            <p class="font-semibold">{m.admin_convertToAdvancedWarningHeader()}</p>
            <ul class="mt-2 list-disc space-y-1 pl-4">
              <li>{m.admin_convertToAdvancedWarningItem1()}</li>
              <li>{m.admin_convertToAdvancedWarningItem2()}</li>
              <li>{m.admin_convertToAdvancedWarningItem3()}</li>
            </ul>
          </div>
          <p class="text-caption text-muted-foreground">
            {m.admin_convertToAdvancedConfirmHintPrefix()}
            <code class="rounded bg-muted px-1 py-0.5 font-mono text-micro">CONVERT</code>
            {m.admin_convertToAdvancedConfirmHintSuffix()}
          </p>
          <input
            type="text"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-body-sm outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus:border-primary"
            placeholder="CONVERT"
            bind:value={convertConfirmText}
            disabled={converting}
            autocomplete="off"
          />
        </div>
        <Dialog.Footer>
          <button
            class="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-muted"
            type="button"
            disabled={converting}
            onclick={cancelConvert}
          >
            {m.common_cancel()}
          </button>
          <button
            class="inline-flex items-center justify-center rounded-full bg-warning px-5 py-2.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={converting || convertConfirmText !== "CONVERT"}
            onclick={submitConvert}
          >
            {converting ? m.admin_convertToAdvancedConverting() : m.admin_convertToAdvancedConfirm()}
          </button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <form
      bind:this={convertFormEl}
      method="POST"
      action="?/convertToAdvanced"
      class="hidden"
    >
      <input type="hidden" name="confirm" value="yes" />
    </form>
  {/if}
</div>
