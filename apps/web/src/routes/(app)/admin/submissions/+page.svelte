<script lang="ts">
  import { untrack } from "svelte";

  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import { Button } from "$lib/components/primitives/ui/button";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { data }: { data: PageData } = $props();

  let userFilter = $state(untrack(() => data.userId));
  let problemFilter = $state(untrack(() => data.problemId));

  function contextLabel(kind: "practice" | "contest" | "assignment" | "exam"): string {
    if (kind === "contest") return m.admin_submissions_contextContest();
    if (kind === "assignment") return m.admin_submissions_contextAssignment();
    if (kind === "exam") return m.admin_submissions_contextExam();
    return m.admin_submissions_contextPractice();
  }

  function applyFilter(e: Event) {
    e.preventDefault();
    const params = new URLSearchParams();
    const u = userFilter.trim();
    const p = problemFilter.trim();
    if (u) params.set("userId", u);
    if (p) params.set("problemId", p);
    window.location.search = params.toString();
  }

  let nextHref = $derived.by(() => {
    if (!data.nextCursor) return null;
    const params = new URLSearchParams();
    if (data.userId) params.set("userId", data.userId);
    if (data.problemId) params.set("problemId", data.problemId);
    params.set("cursor", data.nextCursor);
    return `?${params.toString()}`;
  });
</script>

<PageContainer class="animate-in animate-in-2 space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-h3 font-semibold">{m.admin_submissions_title()}</h1>
    <form class="flex flex-wrap items-center gap-2" onsubmit={applyFilter}>
      <Input
        class="h-9 w-48"
        bind:value={userFilter}
        placeholder={m.admin_submissions_filterUser()}
      />
      <Input
        class="h-9 w-48"
        bind:value={problemFilter}
        placeholder={m.admin_submissions_filterProblem()}
      />
      <Button type="submit" size="sm" variant="outline">{m.admin_submissions_filterBtn()}</Button>
    </form>
  </div>

  {#if data.submissions.length === 0}
    <p
      class="rounded-sm border border-border-subtle bg-muted/20 px-4 py-8 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_submissions_empty()}
    </p>
  {:else}
    <div class="overflow-auto rounded-sm border border-border-subtle">
      <table class="w-full text-body-sm">
        <thead>
          <tr
            class="border-b border-border-subtle bg-muted/40 text-left text-caption uppercase tracking-wider text-muted-foreground"
          >
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colTime()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colUser()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colProblem()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colVerdict()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colScore()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_submissions_colContext()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.submissions as sub (sub.id)}
            <tr class="border-b border-border-subtle last:border-b-0">
              <td class="px-3 py-2 text-caption text-muted-foreground whitespace-nowrap">
                <a class="font-mono hover:underline" href="/submissions/{sub.id}">
                  {formatDateTime(sub.createdAt)}
                </a>
              </td>
              <td class="px-3 py-2 text-caption">{sub.user?.username ?? sub.user?.name ?? "—"}</td>
              <td class="px-3 py-2">
                <a class="hover:underline" href="/problems/{sub.problem.id}">
                  {sub.problem.title}
                </a>
              </td>
              <td class="px-3 py-2"><VerdictBadge verdict={sub.status} /></td>
              <td class="px-3 py-2 tabular-nums">{sub.score}</td>
              <td class="px-3 py-2 text-caption text-muted-foreground">
                {contextLabel(sub.context)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if nextHref}
      <div class="flex justify-center">
        <a
          class="inline-flex min-h-11 items-center rounded-full border border-border px-5 py-2 text-body-sm font-medium hover:bg-accent"
          href={nextHref}
        >
          {m.admin_submissions_next()}
        </a>
      </div>
    {/if}
  {/if}
</PageContainer>
