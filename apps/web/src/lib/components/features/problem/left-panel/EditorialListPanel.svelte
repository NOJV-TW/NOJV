<script lang="ts">
  import { ArrowLeft, ChevronDown, ChevronUp } from "@lucide/svelte";
  import { editorialListResponseSchema, supportedLanguages, type Language } from "@nojv/core";
  import { page } from "$app/state";
  import type { ProblemEditorialEntry } from "$lib/types";
  import { formatDate } from "$lib/utils/datetime";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";

  interface Props {
    problemId: string;
    hasAc: boolean;
    active: boolean;
    formIdSuffix?: string;
  }

  let { problemId, hasAc, active, formIdSuffix = "" }: Props = $props();

  let editorials = $state<ProblemEditorialEntry[]>([]);
  let editorialsLoaded = $state(false);
  let editorialsLoading = $state(false);
  let showEditorialForm = $state(false);
  let editorialTitle = $state("");
  let editorialContent = $state("");
  let editorialLanguage = $state<Language>("python");
  let editorialSubmitting = $state(false);

  let selectedId = $state<string | null>(null);
  let votingId = $state<string | null>(null);

  let reportingId = $state<string | null>(null);
  let reportReason = $state("");
  let reportSubmitting = $state(false);

  const viewerUsername = $derived(page.data.user?.username ?? null);
  const selectedEditorial = $derived(
    selectedId === null ? null : (editorials.find((e) => e.id === selectedId) ?? null),
  );

  function displayTitle(editorial: ProblemEditorialEntry): string {
    const trimmed = editorial.title.trim();
    if (trimmed.length > 0) return trimmed;
    const firstLine = editorial.content
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line.length > 0);
    return firstLine ?? m.editorials_untitled();
  }

  function openReport(id: string) {
    reportingId = id;
    reportReason = "";
  }

  async function submitReport(editorialId: string) {
    if (reportSubmitting || reportReason.trim().length === 0) return;
    reportSubmitting = true;
    try {
      const res = await fetchWithCsrf(`/api/editorials/${editorialId}/reports`, {
        method: "POST",
        body: JSON.stringify({ reason: reportReason.trim() }),
      });
      if (res.ok) {
        reportingId = null;
        reportReason = "";
        toasts.success(m.editorialReport_success());
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.editorialReport_error());
      }
    } catch {
      toasts.error(m.editorialReport_error());
    } finally {
      reportSubmitting = false;
    }
  }

  async function vote(editorial: ProblemEditorialEntry, direction: 1 | -1) {
    if (votingId !== null) return;
    const value = editorial.viewerVote === direction ? 0 : direction;
    votingId = editorial.id;
    try {
      const res = await fetchWithCsrf(`/api/editorials/${editorial.id}/votes`, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        const result: { score: number; viewerVote: number } = await res.json();
        editorials = editorials.map((e) =>
          e.id === editorial.id
            ? { ...e, voteScore: result.score, viewerVote: result.viewerVote }
            : e,
        );
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.editorialReport_error());
      }
    } catch {
      toasts.error(m.editorialReport_error());
    } finally {
      votingId = null;
    }
  }

  const editorialLanguageId = $derived(
    `editorial-language${formIdSuffix ? `-${formIdSuffix}` : ""}`,
  );
  const editorialTitleId = $derived(`editorial-title${formIdSuffix ? `-${formIdSuffix}` : ""}`);

  async function loadEditorials() {
    if (editorialsLoading) return;
    editorialsLoading = true;
    try {
      const res = await fetch(`/api/problems/${problemId}/editorials`);
      if (res.ok) {
        const parsed = editorialListResponseSchema.safeParse(await res.json());
        editorials = parsed.success ? (parsed.data as ProblemEditorialEntry[]) : [];
        editorialsLoaded = true;
      }
    } finally {
      editorialsLoading = false;
    }
  }

  async function submitEditorial() {
    if (editorialSubmitting) return;
    editorialSubmitting = true;
    try {
      const res = await fetchWithCsrf(`/api/problems/${problemId}/editorials`, {
        method: "POST",
        body: JSON.stringify({
          title: editorialTitle.trim(),
          content: editorialContent,
          language: editorialLanguage,
        }),
      });
      if (res.ok) {
        showEditorialForm = false;
        editorialTitle = "";
        editorialContent = "";
        await loadEditorials();
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.editorials_submitError());
      }
    } catch {
      toasts.error(m.editorials_submitError());
    } finally {
      editorialSubmitting = false;
    }
  }

  $effect(() => {
    if (active && hasAc && !editorialsLoaded && !editorialsLoading) {
      void loadEditorials();
    }
  });
</script>

<div class="p-5">
  {#if !hasAc}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.editorials_solveFirst()}
    </p>
  {:else if editorialsLoading && !editorialsLoaded}
    <div class="flex items-center justify-center py-8">
      <div
        class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
      ></div>
    </div>
  {:else if selectedEditorial}
    {@const editorial = selectedEditorial}
    {@const isOwn = viewerUsername !== null && editorial.user.username === viewerUsername}
    <button
      class="mb-4 inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
      onclick={() => (selectedId = null)}
      type="button"
    >
      <ArrowLeft aria-hidden="true" class="h-3.5 w-3.5" />
      {m.editorials_back()}
    </button>

    <div class="mb-3 flex items-start gap-3">
      <div class="flex shrink-0 flex-col items-center gap-0.5">
        <button
          aria-label={m.editorials_upvote()}
          aria-pressed={editorial.viewerVote === 1}
          class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {editorial.viewerVote ===
          1
            ? 'text-success'
            : 'text-muted-foreground'}"
          disabled={isOwn || votingId === editorial.id}
          onclick={() => vote(editorial, 1)}
          type="button"
        >
          <ChevronUp aria-hidden="true" class="h-4 w-4" />
        </button>
        <span class="text-body-sm font-semibold tabular-nums">{editorial.voteScore}</span>
        <button
          aria-label={m.editorials_downvote()}
          aria-pressed={editorial.viewerVote === -1}
          class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {editorial.viewerVote ===
          -1
            ? 'text-destructive'
            : 'text-muted-foreground'}"
          disabled={isOwn || votingId === editorial.id}
          onclick={() => vote(editorial, -1)}
          type="button"
        >
          <ChevronDown aria-hidden="true" class="h-4 w-4" />
        </button>
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-body-md font-semibold leading-snug">{displayTitle(editorial)}</h2>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <span>{m.editorials_by()} {editorial.user.name ?? editorial.user.username}</span>
          <span class="rounded-full bg-muted px-2 py-0.5 font-medium">{editorial.language}</span
          >
          <span class="tabular-nums">{formatDate(editorial.createdAt)}</span>
          {#if !isOwn}
            <button
              class="text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive"
              onclick={() => openReport(editorial.id)}
              type="button"
            >
              {m.editorialReport_button()}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <div class="text-body-sm leading-7">
      <MarkdownRenderer content={editorial.content} />
    </div>

    {#if reportingId === editorial.id}
      <div class="mt-3 rounded-md border border-border-subtle bg-muted/30 p-3">
        <p class="mb-2 text-caption font-medium">{m.editorialReport_title()}</p>
        <textarea
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm leading-6"
          rows="3"
          maxlength="1000"
          placeholder={m.editorialReport_reasonPlaceholder()}
          bind:value={reportReason}></textarea>
        <div class="mt-2 flex items-center gap-2">
          <button
            class="rounded-md bg-destructive px-3 py-1.5 text-caption font-medium text-destructive-foreground transition-[background-color] duration-fast ease-out-soft hover:bg-destructive/90 disabled:opacity-50"
            disabled={reportSubmitting || reportReason.trim().length === 0}
            onclick={() => submitReport(editorial.id)}
            type="button"
          >
            {m.editorialReport_submit()}
          </button>
          <button
            class="rounded-md px-3 py-1.5 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
            onclick={() => (reportingId = null)}
            type="button"
          >
            {m.editorialReport_cancel()}
          </button>
        </div>
      </div>
    {/if}
  {:else}
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-body-sm font-semibold">{m.editorials_title()}</h2>
      <button
        class="rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90"
        onclick={() => (showEditorialForm = !showEditorialForm)}
        type="button"
      >
        {m.editorials_write()}
      </button>
    </div>

    {#if showEditorialForm}
      <div class="mb-6 rounded-md border border-border-subtle p-4">
        <div class="mb-3">
          <label
            class="mb-1 block text-caption font-medium text-muted-foreground"
            for={editorialTitleId}
          >
            {m.editorials_titleLabel()}
          </label>
          <input
            id={editorialTitleId}
            class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
            maxlength="200"
            placeholder={m.editorials_titlePlaceholder()}
            bind:value={editorialTitle}
          />
        </div>
        <div class="mb-3">
          <label
            class="mb-1 block text-caption font-medium text-muted-foreground"
            for={editorialLanguageId}
          >
            {m.editorials_language()}
          </label>
          <select
            id={editorialLanguageId}
            class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
            bind:value={editorialLanguage}
          >
            {#each supportedLanguages as lang (lang)}
              <option value={lang}>{lang}</option>
            {/each}
          </select>
        </div>
        <div class="mb-3">
          <ImageDropZone
            class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
            rows="10"
            name="editorialContent"
            placeholder={m.editorials_contentPlaceholder()}
            bind:value={editorialContent}
          />
        </div>
        <button
          class="rounded-md bg-primary px-4 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
          disabled={editorialSubmitting ||
            editorialTitle.trim().length === 0 ||
            editorialContent.length < 10}
          onclick={submitEditorial}
          type="button"
        >
          {editorialSubmitting ? m.editorials_submitting() : m.editorials_submit()}
        </button>
      </div>
    {/if}

    {#if editorials.length === 0}
      <p class="py-8 text-center text-body-sm text-muted-foreground">
        {m.editorials_empty()}
      </p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each editorials as editorial (editorial.id)}
          <li>
            <button
              class="flex w-full items-center gap-3 rounded-md border border-border-subtle p-3 text-left transition-[border-color,background-color] duration-fast ease-out-soft hover:border-border hover:bg-muted/40"
              onclick={() => (selectedId = editorial.id)}
              type="button"
            >
              <span
                class="flex w-9 shrink-0 flex-col items-center rounded-md bg-muted px-1 py-1.5"
              >
                <ChevronUp aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
                <span class="text-caption font-semibold tabular-nums"
                  >{editorial.voteScore}</span
                >
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-body-sm font-medium text-foreground">
                  {displayTitle(editorial)}
                </span>
                <span class="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
                  <span class="truncate">
                    {editorial.user.name ?? editorial.user.username}
                  </span>
                  <span class="rounded-full bg-muted px-1.5 py-0.5 font-medium">
                    {editorial.language}
                  </span>
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
