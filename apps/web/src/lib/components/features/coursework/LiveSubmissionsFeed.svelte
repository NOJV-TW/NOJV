<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
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
  }

  let { rows }: Props = $props();
  let verdictFilter = $state("");
  let languageFilter = $state("");
  let problemFilter = $state("");
  let identitySearch = $state("");

  const verdicts = $derived([...new Set(rows.map((row) => row.status))].sort());
  const languages = $derived([...new Set(rows.map((row) => row.language))].sort());
  const problems = $derived.by(() => {
    const unique = new Map(rows.map((row) => [row.problem.id, row.problem]));
    return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title));
  });
  const filteredRows = $derived.by(() => {
    const query = identitySearch.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (verdictFilter && row.status !== verdictFilter) return false;
      if (languageFilter && row.language !== languageFilter) return false;
      if (problemFilter && row.problem.id !== problemFilter) return false;
      if (!query) return true;
      return [row.user?.username, row.ipAddress].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      );
    });
  });

  onMount(() => {
    const timer = window.setInterval(() => void invalidateAll(), 5000);
    return () => window.clearInterval(timer);
  });
</script>

{#if rows.length === 0}
  <div class="px-6 py-14 text-center text-body-sm text-muted-foreground">
    {m.liveSubmissions_empty()}
  </div>
{:else}
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <select
        aria-label={m.submissions_filterVerdict()}
        class="h-9 min-w-32 rounded-md border border-border bg-background px-3 text-body-sm"
        bind:value={verdictFilter}
      >
        <option value="">{m.submissions_filterVerdict()}: {m.submissions_filterAll()}</option>
        {#each verdicts as verdict (verdict)}
          <option value={verdict}>{formatVerdictLabel(verdict)}</option>
        {/each}
      </select>
      <select
        aria-label={m.submissions_filterLanguage()}
        class="h-9 min-w-32 rounded-md border border-border bg-background px-3 text-body-sm"
        bind:value={languageFilter}
      >
        <option value="">{m.submissions_filterLanguage()}: {m.submissions_filterAll()}</option>
        {#each languages as language (language)}
          <option value={language}>{languageLabel(language)}</option>
        {/each}
      </select>
      <select
        aria-label={m.submissions_filterProblem()}
        class="h-9 min-w-40 rounded-md border border-border bg-background px-3 text-body-sm"
        bind:value={problemFilter}
      >
        <option value="">{m.submissions_filterProblem()}: {m.submissions_filterAll()}</option>
        {#each problems as problem (problem.id)}
          <option value={problem.id}>{problem.title}</option>
        {/each}
      </select>
      <input
        aria-label={m.liveSubmissions_searchPlaceholder()}
        class="h-9 min-w-52 flex-1 rounded-md border border-border bg-background px-3 text-body-sm placeholder:text-muted-foreground sm:max-w-72"
        placeholder={m.liveSubmissions_searchPlaceholder()}
        type="search"
        bind:value={identitySearch}
      />
      <span class="ml-auto whitespace-nowrap text-caption text-muted-foreground">
        {m.liveSubmissions_filterCount({ visible: filteredRows.length, total: rows.length })}
      </span>
    </div>

    {#if filteredRows.length === 0}
      <div class="px-6 py-14 text-center text-body-sm text-muted-foreground">
        {m.submissions_noMatches()}
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead
            class="bg-muted/40 font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            <tr>
              <th class="px-4 py-2.5 text-left font-medium">{m.admin_submissions_colTime()}</th>
              <th class="px-3 py-2.5 text-left font-medium">{m.admin_submissions_colUser()}</th>
              <th class="px-3 py-2.5 text-left font-medium"
                >{m.admin_submissions_colProblem()}</th
              >
              <th class="px-3 py-2.5 text-left font-medium">{m.liveSubmissions_language()}</th>
              <th class="px-3 py-2.5 text-left font-medium">{m.liveSubmissions_ipAddress()}</th>
              <th class="px-3 py-2.5 text-left font-medium"
                >{m.admin_submissions_colVerdict()}</th
              >
              <th class="px-4 py-2.5 text-right font-medium"
                >{m.admin_submissions_colScore()}</th
              >
            </tr>
          </thead>
          <tbody>
            {#each filteredRows as row (row.id)}
              <tr class="border-t border-border-subtle transition-colors hover:bg-muted/25">
                <td
                  class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground"
                >
                  <a
                    class="hover:text-foreground hover:underline"
                    href={`/submissions/${row.id}`}
                  >
                    {formatDateTime(row.createdAt)}
                  </a>
                </td>
                <td class="px-3 py-3">
                  <div class="font-medium">{row.user?.name ?? "—"}</div>
                  <div class="font-mono text-micro text-muted-foreground">
                    {row.user?.username ?? "—"}
                  </div>
                </td>
                <td class="px-3 py-3">
                  <a class="font-medium hover:underline" href={`/problems/${row.problem.id}`}
                    >{row.problem.title}</a
                  >
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
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}
