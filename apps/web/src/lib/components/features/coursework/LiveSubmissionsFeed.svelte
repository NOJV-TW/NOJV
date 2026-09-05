<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import { languageLabel, type Language } from "@nojv/core";

  interface SubmissionRow {
    id: string;
    createdAt: string;
    ipAddress: string | null;
    language: Language;
    score: number;
    status: string;
    problem: { id: string; title: string };
    user: { id: string; name: string; username: string | null } | null;
  }

  interface Props {
    rows: SubmissionRow[];
    refreshUrl: string;
    search?: string;
    visibleCount?: number;
  }

  let {
    rows,
    refreshUrl,
    search = $bindable(""),
    visibleCount = $bindable(rows.length),
  }: Props = $props();
  let refreshedRows = $state<SubmissionRow[] | null>(null);
  let verdictFilter = $state("");
  let languageFilter = $state("");
  let problemFilter = $state("");

  const liveRows = $derived(refreshedRows ?? rows);

  const verdicts = $derived([...new Set(liveRows.map((row) => row.status))].sort());
  const languages = $derived([...new Set(liveRows.map((row) => row.language))].sort());
  const problems = $derived.by(() => {
    const unique = new Map(liveRows.map((row) => [row.problem.id, row.problem]));
    return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title));
  });
  const filteredRows = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    return liveRows.filter((row) => {
      if (verdictFilter && row.status !== verdictFilter) return false;
      if (languageFilter && row.language !== languageFilter) return false;
      if (problemFilter && row.problem.id !== problemFilter) return false;
      if (!query) return true;
      return [row.user?.username, row.ipAddress].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      );
    });
  });
  $effect(() => {
    visibleCount = filteredRows.length;
  });

  function openSubmission(id: string) {
    void goto(`/submissions/${id}`);
  }

  function handleRowKeydown(event: KeyboardEvent, id: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openSubmission(id);
  }

  onMount(() => {
    let refreshing = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const response = await fetch(refreshUrl, { headers: { accept: "application/json" } });
        if (response.ok) {
          refreshedRows = ((await response.json()) as { items: SubmissionRow[] }).items;
        }
      } catch {
        return;
      } finally {
        refreshing = false;
      }
    };
    const onVisibilityChange = () => void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  });
</script>

{#if liveRows.length === 0}
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
                >{row.score}</td
              >
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
{/if}
