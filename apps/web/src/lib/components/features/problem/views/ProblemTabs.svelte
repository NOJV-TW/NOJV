<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { ChevronDown, Plus } from "@lucide/svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { fetchWithCsrf } from "$lib/services/http";
  import type { problemDomain } from "@nojv/domain";
  import PublicProblemsTab from "../listings/PublicProblemsTab.svelte";
  import MyProblemsTab, { type EditableProblemCard } from "../listings/MyProblemsTab.svelte";

  type ProblemListResult = problemDomain.ProblemListResult;

  interface Props {
    editableProblems: EditableProblemCard[] | null;
    publicResult: ProblemListResult;
    showCreate?: boolean;
    loggedIn?: boolean;
    advancedModeSupported?: boolean;
  }

  let {
    editableProblems,
    publicResult,
    showCreate,
    loggedIn = false,
    advancedModeSupported = true,
  }: Props = $props();

  let creating = $state(false);
  let showCreateMenu = $state(false);

  let currentUrl = $derived(page.url);
  let tab = $derived<"public" | "mine">(
    showCreate && currentUrl.searchParams.get("tab") === "mine" ? "mine" : "public"
  );

  async function handleCreate(mode: "standard" | "advanced" = "standard") {
    creating = true;
    showCreateMenu = false;
    try {
      const res = await fetchWithCsrf("/api/problems", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      if (!res.ok) throw new Error("Failed to create problem");
      const body = (await res.json()) as { id: string; mode: "standard" | "advanced" };
      await goto(`/problems/${body.id}/edit`);
    } finally {
      creating = false;
    }
  }

  function setTab(nextTab: "public" | "mine") {
    const params = new URLSearchParams(currentUrl.searchParams);
    if (nextTab === "mine") {
      params.set("tab", "mine");
    } else {
      params.delete("tab");
    }
    const qs = params.toString();
    const target = qs ? `?${qs}` : currentUrl.pathname;
    goto(target, { keepFocus: true, noScroll: true });
  }

  let showDeleteConfirm = $state(false);
  let deletingProblemId = $state<string | null>(null);
  let isDeleting = $state(false);

  function handleDeleteClick(problemId: string) {
    deletingProblemId = problemId;
    showDeleteConfirm = true;
  }

  async function handleDeleteConfirmed() {
    if (!deletingProblemId) return;
    showDeleteConfirm = false;
    isDeleting = true;
    const fd = new FormData();
    await fetch(`/problems/${deletingProblemId}/edit?/deleteProblem`, { method: "POST", body: fd });
    isDeleting = false;
    deletingProblemId = null;
    await invalidateAll();
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center gap-2">
    <button
      class="rounded-full border px-4 py-2 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {tab === 'public'
        ? 'border-primary bg-primary text-white'
        : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
      onclick={() => setTab("public")}
      type="button"
    >
      {m.problems_publicLibrary()}
    </button>
    {#if showCreate}
      <button
        class="rounded-full border px-4 py-2 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {tab === 'mine'
          ? 'border-primary bg-primary text-white'
          : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
        onclick={() => setTab("mine")}
        type="button"
      >
        {m.problems_myProblems()}
      </button>
      <div class="relative ml-auto">
        <Button
          disabled={creating}
          loading={creating}
          onclick={() => { showCreateMenu = !showCreateMenu; }}
          class="rounded-full"
        >
          <Plus class="size-4" aria-hidden="true" />
          {creating ? m.common_saving() : m.problems_createNew()}
          <ChevronDown class="size-3 opacity-70" aria-hidden="true" />
        </Button>
        {#if showCreateMenu}
          <div
            class="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-border bg-[color:var(--color-panel)] p-2 shadow-hover"
            role="menu"
          >
            <button
              class="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
              onclick={() => void handleCreate("standard")}
              type="button"
            >
              <span class="font-semibold">{m.problems_createStandardTitle()}</span>
              <span class="text-caption text-muted-foreground">
                {m.problems_createStandardDescription()}
              </span>
            </button>
            {#if advancedModeSupported}
              <button
                class="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
                onclick={() => void handleCreate("advanced")}
                type="button"
              >
                <span class="font-semibold">{m.problems_createAdvancedTitle()}</span>
                <span class="text-caption text-muted-foreground">
                  {m.problems_createAdvancedDescription()}
                </span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if tab === "public"}
    <PublicProblemsTab {publicResult} {loggedIn} />
  {:else if tab === "mine" && showCreate}
    <MyProblemsTab
      editableProblems={editableProblems ?? []}
      {deletingProblemId}
      {isDeleting}
      onDeleteClick={handleDeleteClick}
    />
  {/if}
</div>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title={m.admin_deleteProblemTitle()}
  message={m.admin_deleteProblemMessage()}
  confirmText={m.common_delete()}
  cancelText={m.admin_cancel()}
  variant="danger"
  onconfirm={handleDeleteConfirmed}
  oncancel={() => { showDeleteConfirm = false; deletingProblemId = null; }}
/>
