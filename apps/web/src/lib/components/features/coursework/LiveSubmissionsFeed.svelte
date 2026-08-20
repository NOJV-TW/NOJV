<script lang="ts">
  import { onMount } from "svelte";
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
          <th class="px-4 py-2.5 text-left font-medium">{m.admin_submissions_colTime()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.admin_submissions_colUser()}</th>
          <th class="px-2 py-1.5 text-left font-medium">
            <select
              aria-label={m.submissions_filterProblem()}
              class="h-8 max-w-48 rounded border border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border focus:border-border"
              bind:value={problemFilter}
            >
              <option value="">{m.admin_submissions_colProblem()}</option>
              {#each problems as problem (problem.id)}
                <option value={problem.id}>{problem.title}</option>
              {/each}
            </select>
          </th>
          <th class="px-2 py-1.5 text-left font-medium">
            <select
              aria-label={m.submissions_filterLanguage()}
              class="h-8 rounded border border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border focus:border-border"
              bind:value={languageFilter}
            >
              <option value="">{m.liveSubmissions_language()}</option>
              {#each languages as language (language)}
                <option value={language}>{languageLabel(language)}</option>
              {/each}
            </select>
          </th>
          <th class="px-3 py-2.5 text-left font-medium">{m.liveSubmissions_ipAddress()}</th>
          <th class="px-2 py-1.5 text-left font-medium">
            <select
              aria-label={m.submissions_filterVerdict()}
              class="h-8 rounded border border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border focus:border-border"
              bind:value={verdictFilter}
            >
              <option value="">{m.admin_submissions_colVerdict()}</option>
              {#each verdicts as verdict (verdict)}
                <option value={verdict}>{formatVerdictLabel(verdict)}</option>
              {/each}
            </select>
          </th>
          <th class="px-4 py-2.5 text-right font-medium">{m.admin_submissions_colScore()}</th>
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
        {/if}
      </tbody>
    </table>
  </div>
{/if}
