<script lang="ts">
  import type { Snippet } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Tooltip } from "bits-ui";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  interface Props {
    activeSection?: string;
    canPublish?: boolean;
    showPublish?: boolean;
    publishing?: boolean;
    basicInfoComplete?: boolean;
    dirty?: boolean;
    testcaseCount?: number;
    onpublish?: () => void;
    basic?: Snippet;
    workspace?: Snippet;
    testcase?: Snippet;
    judge?: Snippet;
  }

  let {
    activeSection = $bindable("basic"),
    canPublish = false,
    showPublish = false,
    publishing = false,
    basicInfoComplete = false,
    dirty = $bindable(false),
    testcaseCount = 0,
    onpublish,
    basic,
    workspace,
    testcase,
    judge,
  }: Props = $props();

  let showUnsavedModal = $state(false);
  let pendingSection = $state<string | null>(null);

  const sections: { id: string; label: string; icon: string }[] = [
    { id: "basic", label: m.admin_tabBasicInfo(), icon: "📝" },
    { id: "workspace", label: "Workspace", icon: "💻" },
    { id: "testcase", label: m.admin_tabTestcase(), icon: "🧪" },
    { id: "judge", label: m.admin_tabJudge(), icon: "⚖️" },
  ];

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
  <nav class="w-52 shrink-0 rounded-2xl border border-border bg-[color:var(--color-panel)] p-2">
    <ul class="space-y-1">
      {#each sections as section (section.id)}
        {@const locked = isLocked(section.id)}
        <li>
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
              <Tooltip.Trigger
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition
                  {locked
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : activeSection === section.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                onclick={() => { if (!locked) handleSectionClick(section.id); }}
                type="button"
                disabled={locked}
              >
                <span class="text-base">{section.icon}</span>
                <span class="flex-1 text-left">{section.label}</span>
                <span class="text-xs text-muted-foreground">{statusBadge(section.id)}</span>
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
        </li>
      {/each}
    </ul>

    {#if showPublish}
      <div class="mt-4 border-t border-border pt-4">
        {#if canPublish}
          <button
            class="w-full rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
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
                class="w-full cursor-not-allowed rounded-full bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground/50"
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
</div>
