<script lang="ts">
  import type { Snippet } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Tooltip } from "bits-ui";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  interface Props {
    activeTab?: string;
    canPublish?: boolean;
    showPublish?: boolean;
    publishing?: boolean;
    basicInfoComplete?: boolean;
    dirty?: boolean;
    onpublish?: () => void;
    basic?: Snippet;
    workspace?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
  }

  let {
    activeTab = $bindable("basic"),
    canPublish = false,
    showPublish = false,
    publishing = false,
    basicInfoComplete = false,
    dirty = $bindable(false),
    onpublish,
    basic,
    workspace,
    testcase,
    judge,
  }: Props = $props();

  let showUnsavedModal = $state(false);
  let pendingTab = $state<string | null>(null);

  function handleTabClick(tabId: string) {
    if (tabId === activeTab) return;
    if (dirty) {
      pendingTab = tabId;
      showUnsavedModal = true;
    } else {
      activeTab = tabId;
    }
  }

  function confirmTabSwitch() {
    showUnsavedModal = false;
    dirty = false;
    if (pendingTab) {
      activeTab = pendingTab;
      pendingTab = null;
    }
  }

  function cancelTabSwitch() {
    showUnsavedModal = false;
    pendingTab = null;
  }

  const tabs = [
    { id: "basic", label: m.admin_tabBasicInfo() },
    { id: "workspace", label: "Workspace" },
    { id: "testcase", label: m.admin_tabTestcase() },
    { id: "judge", label: m.admin_tabJudge() },
  ];
</script>

<div>
  <nav class="flex items-center border-b border-border mb-6">
    <div class="flex gap-1">
      {#each tabs as tab (tab.id)}
        {@const locked = tab.id !== "basic" && !basicInfoComplete}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger
              class="px-4 py-2.5 text-sm font-medium transition-colors relative
                {locked
                  ? 'text-muted-foreground/40 cursor-not-allowed'
                  : activeTab === tab.id
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => { if (!locked) handleTabClick(tab.id); }}
              type="button"
              disabled={locked}
            >
              {tab.label}
              {#if activeTab === tab.id}
                <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></span>
              {/if}
            </Tooltip.Trigger>
            {#if locked}
              <Tooltip.Portal>
                <Tooltip.Content
                  class="z-50 max-w-xs rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                  sideOffset={4}
                >
                  {m.admin_tabLocked()}
                  <Tooltip.Arrow class="fill-popover stroke-border" />
                </Tooltip.Content>
              </Tooltip.Portal>
            {/if}
          </Tooltip.Root>
        </Tooltip.Provider>
      {/each}
    </div>

    {#if showPublish}
      <div class="ml-auto">
        {#if canPublish}
          <button
            class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
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
                class="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground/50 cursor-not-allowed"
                type="button"
                onclick={(e: MouseEvent) => e.preventDefault()}
              >
                {m.admin_publishProblem()}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  class="z-50 max-w-xs rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
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
  </nav>

  {#if activeTab === "basic" && basic}
    {@render basic()}
  {:else if activeTab === "workspace" && workspace}
    {@render workspace()}
  {:else if activeTab === "testcase" && testcase}
    {@render testcase()}
  {:else if activeTab === "judge" && judge}
    {@render judge()}
  {/if}

  <ConfirmDialog
    bind:open={showUnsavedModal}
    title={m.admin_unsavedChangesTitle()}
    message={m.admin_unsavedChangesMessage()}
    confirmText={m.admin_unsavedLeave()}
    cancelText={m.admin_unsavedStay()}
    onconfirm={confirmTabSwitch}
    oncancel={cancelTabSwitch}
  />
</div>
