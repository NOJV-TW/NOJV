<script lang="ts">
  import { untrack } from "svelte";
  import { createSubmissionHistory } from "$lib/services/submission-history.svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import { isSubmissionPending, languageLabel, type Language } from "@nojv/core";

  const SEARCH_DEBOUNCE_MS = 250;

  interface SubmissionRow {
    id: string;
    createdAt: string;
    ipAddress: string | null;
    language: Language;
    score: number | null;
    status: string;
    problem: { id: string; title: string };
    user: { id: string; name: string; username: string | null } | null;
  }

  interface Props {
    rows: SubmissionRow[];
    refreshUrl: string;
    search?: string;
    visibleCount?: number;
    totalCount?: number;
  }

  let {
    rows,
    refreshUrl,
    search = $bindable(""),
    visibleCount = $bindable(rows.length),
    totalCount = $bindable(rows.length),
  }: Props = $props();
  let verdictFilter = $state("");
  let languageFilter = $state("");
  let problemFilter = $state("");
  let debouncedSearch = $state(untrack(() => search));

  $effect(() => {
    const next = search;
    const timer = setTimeout(() => (debouncedSearch = next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const history = createSubmissionHistory<SubmissionRow>(
    () => {
      const query = new URL(refreshUrl, "http://localhost").searchParams;
      if (verdictFilter) query.set("status", verdictFilter);
      if (languageFilter) query.set("language", languageFilter);
      if (problemFilter) query.set("filterProblemId", problemFilter);
      if (debouncedSearch) query.set("search", debouncedSearch);
      return query.toString();
    },
    () => rows,
  );
  const liveRows = $derived(history.items);

  const verdicts = $derived([...new Set(liveRows.map((row) => row.status))].sort());
  const languages = $derived([...new Set(liveRows.map((row) => row.language))].sort());
  const problems = $derived.by(() => {
    const unique = new Map(liveRows.map((row) => [row.problem.id, row.problem]));
    return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title));
  });
  const filteredRows = $derived(liveRows);
  $effect(() => {
    visibleCount = filteredRows.length;
    totalCount = history.totalCount;
  });

  function openSubmission(id: string) {
    void goto(`/submissions/${id}`);
  }

  function handleRowKeydown(event: KeyboardEvent, id: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openSubmission(id);
  }
</script>

{#if history.newCount > 0}
  <button
    type="button"
    class="m-4 rounded-md border border-primary px-4 py-2 text-body-sm"
    onclick={history.showLatest}>{m.submissions_newRecords({ count: history.newCount })}</button
  >
{/if}
{#if history.failed}
  <button type="button" class="m-4 text-destructive" onclick={history.retry}
    >{m.submissions_loadFailed()} {m.common_retry()}</button
  >
{/if}
{#if liveRows.length === 0 && !verdictFilter && !languageFilter && !problemFilter && !search}
  <div class="px-6 py-14 text-center text-body-sm text-muted-foreground">
    {m.liveSubmissions_empty()}
  </div>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full text-body-sm">
      <thead
        class="bg-muted/40 font-mono text-micro uppercase tracking-wider text-muted-foreground"
      >
        <tr>
          <th class="px-4 py-3 text-left align-middle font-medium">
            {m.admin_submissions_colTime()}
          </th>
          <th class="px-3 py-3 text-left align-middle font-medium">
            {m.admin_submissions_colUser()}
          </th>
          <th class="px-2 py-3 text-left align-middle font-medium">
            <TableSelectColumnFilter
              label={m.admin_submissions_colProblem()}
              filterLabel={m.submissions_filterProblem()}
              options={problems.map((problem) => ({
                value: problem.id,
                label: problem.title,
              }))}
              bind:value={problemFilter}
            />
          </th>
          <th class="px-2 py-3 text-left align-middle font-medium">
            <TableSelectColumnFilter
              label={m.liveSubmissions_language()}
              filterLabel={m.submissions_filterLanguage()}
              options={languages.map((value) => ({ value, label: languageLabel(value) }))}
              bind:value={languageFilter}
            />
          </th>
          <th class="px-3 py-3 text-left align-middle font-medium">
            {m.liveSubmissions_ipAddress()}
          </th>
          <th class="px-2 py-3 text-left align-middle font-medium">
            <TableSelectColumnFilter
              label={m.admin_submissions_colVerdict()}
              filterLabel={m.submissions_filterVerdict()}
              options={verdicts.map((value) => ({
                value,
                label: formatVerdictLabel(value),
              }))}
              bind:value={verdictFilter}
            />
          </th>
          <th class="px-4 py-3 text-right align-middle font-medium">
            {m.admin_submissions_colScore()}
          </th>
        </tr>
      </thead>
      <tbody>
        {#if filteredRows.length === 0}
          <tr class="border-t border-border-subtle">
            <td class="px-6 py-14 text-center text-muted-foreground" colspan="7">
              {m.submissions_noMatches()}
            </td>
          </tr>
        {:else}
          {#each filteredRows as row (row.id)}
            <tr
              class="cursor-pointer border-t border-border-subtle transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
              role="link"
              tabindex="0"
              onclick={() => openSubmission(row.id)}
              onkeydown={(event) => handleRowKeydown(event, row.id)}
            >
              <td
                class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground"
              >
                {formatDateTime(row.createdAt)}
              </td>
              <td class="px-3 py-3">
                <div class="font-medium">{row.user?.name ?? "—"}</div>
                <div class="font-mono text-micro text-muted-foreground">
                  {row.user?.username ?? "—"}
                </div>
              </td>
              <td class="px-3 py-3">
                <span class="font-medium">{row.problem.title}</span>
              </td>
              <td
                class="whitespace-nowrap px-3 py-3 font-mono text-caption text-muted-foreground"
              >
                {languageLabel(row.language)}
              </td>
              <td
                class="whitespace-nowrap px-3 py-3 font-mono text-caption text-muted-foreground"
              >
                {row.ipAddress ?? "—"}
              </td>
              <td class="px-3 py-3"><VerdictBadge verdict={row.status} /></td>
              <td class="px-4 py-3 text-right font-mono font-semibold tabular-nums"
                >{isSubmissionPending(row.status) ? "—" : row.score}</td
              >
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
{/if}

{#if history.totalPages > 1}
  <nav class="flex items-center justify-center gap-2 p-4" aria-label={m.problems_pagination()}>
    <button
      type="button"
      disabled={history.page === 1 || history.loading}
      onclick={() => history.goToPage(history.page - 1)}>{m.submissions_previous()}</button
    >
    {#each Array.from({ length: Math.min(5, history.totalPages) }, (_, i) => Math.min(Math.max(1, history.page - 2), Math.max(1, history.totalPages - 4)) + i) as number}
      <button
        type="button"
        class="rounded-md px-3 py-2"
        aria-current={number === history.page ? "page" : undefined}
        disabled={history.loading}
        onclick={() => history.goToPage(number)}>{number}</button
      >
    {/each}
    <button
      type="button"
      disabled={history.page === history.totalPages || history.loading}
      onclick={() => history.goToPage(history.page + 1)}>{m.submissions_next()}</button
    >
  </nav>
{/if}
