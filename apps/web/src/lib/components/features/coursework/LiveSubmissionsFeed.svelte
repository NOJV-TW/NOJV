<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
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
  <div class="overflow-x-auto">
    <table class="w-full text-body-sm">
      <thead
        class="bg-muted/40 font-mono text-micro uppercase tracking-wider text-muted-foreground"
      >
        <tr>
          <th class="px-4 py-2.5 text-left font-medium">{m.admin_submissions_colTime()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.admin_submissions_colUser()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.admin_submissions_colProblem()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.liveSubmissions_language()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.liveSubmissions_ipAddress()}</th>
          <th class="px-3 py-2.5 text-left font-medium">{m.admin_submissions_colVerdict()}</th>
          <th class="px-4 py-2.5 text-right font-medium">{m.admin_submissions_colScore()}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-t border-border-subtle transition-colors hover:bg-muted/25">
            <td
              class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground"
            >
              <a class="hover:text-foreground hover:underline" href={`/submissions/${row.id}`}>
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
