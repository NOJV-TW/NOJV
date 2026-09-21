<script lang="ts">
  import {
    ChevronFirst,
    ChevronLast,
    ChevronLeft,
    ChevronRight,
    Code2,
    History,
  } from "@lucide/svelte";
  import { languageLabel, languageSchema, submissionResultVerdicts } from "@nojv/core";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { createSubmissionHistory } from "$lib/services/submission-history.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";

  let { data } = $props();

  type SubmissionRow = (typeof data.submissions)[number];

  let verdictFilter = $state("");
  let languageFilter = $state("");
  let problemFilter = $state("");
  let contextFilter = $state("");
  let userFilter = $state("");
  const history = createSubmissionHistory<SubmissionRow>(
    () => {
      const query = new URLSearchParams();
      if (verdictFilter) query.set("status", verdictFilter);
      if (languageFilter) query.set("language", languageFilter);
      if (problemFilter) query.set("filterProblemId", problemFilter);
      if (contextFilter) query.set("contextType", contextFilter);
      if (data.adminAccessActive && userFilter) query.set("userSearch", userFilter);
      return query.toString();
    },
    () => data.submissions,
  );
  const currentPage = $derived(history.page);
  const totalPages = $derived(history.totalPages);
  const loadingPage = $derived(history.loading);
  const allRows = $derived(history.items);
  const filtered = $derived(history.items);
  const pageNumbers = $derived.by(() => {
    const start = Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4));
    return Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  });
  const goToPage = history.goToPage;

  function contextLabel(kind: SubmissionRow["context"]): string {
    switch (kind) {
      case "assignment":
        return m.submissions_kind_assignment();
      case "contest":
        return m.submissions_kind_contest();
      case "exam":
        return m.submissions_kind_exam();
      default:
        return m.submissions_kind_practice();
    }
  }

  function displayLanguage(value: string): string {
    const parsed = languageSchema.safeParse(value);
    return parsed.success ? languageLabel(parsed.data) : value;
  }

  const RESULT_VERDICTS: readonly string[] = submissionResultVerdicts;
  let verdictOptions = $derived([
    ...RESULT_VERDICTS,
    ...[...new Set(allRows.map((s) => s.status))]
      .filter((status) => !RESULT_VERDICTS.includes(status))
      .sort(),
  ]);
  let languageOptions = $derived([...new Set(allRows.map((s) => s.language))].sort());
  let contextOptions = $derived([...new Set(allRows.map((s) => s.context))].sort());
  let problemOptions = $derived.by(() => {
    const unique = new Map(
      allRows.map((submission) => [submission.problemId, submission.problemTitle]),
    );
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  const PENDING_STATUSES = new Set(["pending_upload", "queued", "compiling", "running"]);
  function openSubmission(id: string) {
    void goto(`/submissions/${id}`);
  }

  function handleRowKeydown(event: KeyboardEvent, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSubmission(id);
  }
</script>

<PageContainer>
  <div class="space-y-6 fade-up">
    <PageHeader
      eyebrow={m.submissionsTop_eyebrow()}
      title={m.navigation_submissions()}
      description={m.submissions_workspaceHint()}
    >
      {#snippet icon()}
        <History class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

    {#if history.newCount > 0}
      <button
        type="button"
        class="rounded-md border border-primary px-4 py-2 text-body-sm"
        onclick={history.showLatest}
        >{m.submissions_newRecords({ count: history.newCount })}</button
      >
    {/if}
    {#if history.failed}
      <button type="button" class="text-destructive" onclick={history.retry}
        >{m.submissions_loadFailed()} {m.common_retry()}</button
      >
    {/if}
    {#if allRows.length === 0 && !verdictFilter && !languageFilter && !problemFilter && !contextFilter && !userFilter}
      <EmptyState
        variant="onboarding"
        icon={Code2}
        title={m.submissions_empty()}
        description={m.submissions_emptyHint()}
        actions={[
          {
            href: "/problems",
            label: m.submissions_browseCta(),
            variant: "default",
          },
        ]}
      />
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
            <tr>
              <th class="px-4 py-3 text-left align-middle font-medium">
                {m.admin_submissions_colTime()}
              </th>
              {#if data.adminAccessActive}
                <th class="px-4 py-3 text-left align-middle font-medium">
                  <TableTextColumnFilter
                    label={m.admin_submissions_colUser()}
                    filterLabel={m.submissions_filterUser()}
                    inputId="submissions-user-search"
                    applyLabel={m.common_applyFilter()}
                    bind:value={userFilter}
                  />
                </th>
              {/if}
              <th class="px-2 py-3 text-left align-middle font-medium">
                <TableSelectColumnFilter
                  label={m.admin_submissions_colProblem()}
                  filterLabel={m.submissions_filterProblem()}
                  options={problemOptions.map(([value, label]) => ({ value, label }))}
                  bind:value={problemFilter}
                  onChange={() => undefined}
                />
              </th>
              <th class="px-2 py-3 text-left align-middle font-medium">
                <TableSelectColumnFilter
                  label={m.admin_submissions_colContext()}
                  filterLabel={m.admin_submissions_colContext()}
                  options={contextOptions.map((value) => ({
                    value,
                    label: contextLabel(value),
                  }))}
                  bind:value={contextFilter}
                  onChange={() => undefined}
                />
              </th>
              <th class="px-2 py-3 text-left align-middle font-medium">
                <TableSelectColumnFilter
                  label={m.submissions_filterLanguage()}
                  filterLabel={m.submissions_filterLanguage()}
                  options={languageOptions.map((value) => ({
                    value,
                    label: displayLanguage(value),
                  }))}
                  bind:value={languageFilter}
                  onChange={() => undefined}
                />
              </th>
              <th class="px-2 py-3 text-left align-middle font-medium">
                <TableSelectColumnFilter
                  label={m.admin_submissions_colVerdict()}
                  filterLabel={m.submissions_filterVerdict()}
                  options={verdictOptions.map((value) => ({
                    value,
                    label: formatVerdictLabel(value),
                  }))}
                  bind:value={verdictFilter}
                  onChange={() => undefined}
                />
              </th>
              <th class="px-3 py-3 text-right align-middle font-medium"
                >{m.admin_submissions_colScore()}</th
              >
            </tr>
          </thead>
          <tbody>
            {#if filtered.length === 0}
              <tr class="border-t border-border-subtle">
                <td
                  class="px-6 py-14 text-center text-muted-foreground"
                  colspan={data.adminAccessActive ? 7 : 6}
                >
                  {m.submissions_noMatches()}
                </td>
              </tr>
            {:else}
              {#each filtered as sub (sub.id)}
                <tr
                  class="cursor-pointer border-t border-border-subtle transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
                  role="link"
                  tabindex="0"
                  onclick={() => openSubmission(sub.id)}
                  onkeydown={(event) => handleRowKeydown(event, sub.id)}
                >
                  <td
                    class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground"
                  >
                    {formatDateTime(sub.createdAt)}
                  </td>
                  {#if data.adminAccessActive}
                    <td class="px-4 py-3">
                      {#if sub.user}
                        <div class="font-medium">{sub.user.name}</div>
                        {#if sub.user.username}
                          <div class="font-mono text-caption text-muted-foreground">
                            @{sub.user.username}
                          </div>
                        {/if}
                      {/if}
                    </td>
                  {/if}
                  <td class="px-3 py-3">
                    <span class="font-medium">{sub.problemTitle}</span>
                  </td>
                  <td class="px-3 py-3 text-caption text-muted-foreground">
                    {contextLabel(sub.context)}
                  </td>
                  <td
                    class="whitespace-nowrap px-3 py-3 font-mono text-caption text-muted-foreground"
                  >
                    {languageLabel(sub.language)}
                  </td>
                  <td class="px-3 py-3">
                    {#if PENDING_STATUSES.has(sub.status)}
                      <span
                        class="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
                      >
                        <span
                          class="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground"
                          aria-hidden="true"
                        ></span>
                        {m.submission_pending()}
                      </span>
                    {:else}
                      <VerdictBadge verdict={sub.status} />
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-right font-mono tabular-nums">
                    <span class="text-body-sm font-semibold text-foreground"
                      >{PENDING_STATUSES.has(sub.status) ? "—" : sub.score}</span
                    >
                    <span class="text-caption text-muted-foreground">/{sub.totalScore}</span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      {#if totalPages > 1}
        <nav
          class="mt-4 flex items-center justify-center gap-1"
          aria-label={m.problems_pagination()}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.submissions_first()}
            title={m.submissions_first()}
            disabled={currentPage === 1 || loadingPage}
            onclick={() => void goToPage(1)}
          >
            <ChevronFirst class="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.submissions_previous()}
            title={m.submissions_previous()}
            disabled={currentPage === 1 || loadingPage}
            onclick={() => void goToPage(currentPage - 1)}
          >
            <ChevronLeft class="size-4" aria-hidden="true" />
          </Button>
          {#each pageNumbers as page}
            <Button
              variant={page === currentPage ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={m.submissions_page({ page })}
              aria-current={page === currentPage ? "page" : undefined}
              disabled={loadingPage}
              onclick={() => void goToPage(page)}>{page}</Button
            >
          {/each}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.submissions_next()}
            title={m.submissions_next()}
            disabled={currentPage === totalPages || loadingPage}
            onclick={() => void goToPage(currentPage + 1)}
          >
            <ChevronRight class="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.submissions_last()}
            title={m.submissions_last()}
            disabled={currentPage === totalPages || loadingPage}
            onclick={() => void goToPage(totalPages)}
          >
            <ChevronLast class="size-4" aria-hidden="true" />
          </Button>
        </nav>
      {/if}
    {/if}
  </div>
</PageContainer>
