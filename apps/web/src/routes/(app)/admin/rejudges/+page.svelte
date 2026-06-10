<script lang="ts">
  import { untrack } from "svelte";

  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { toasts } from "$lib/stores/toast";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let problemFilter = $state(untrack(() => data.problemId));
  let pendingTimeout = $state(untrack(() => String(data.pendingTimeoutMinutes)));
  let savingTimeout = $state(false);

  function applyFilter(e: Event) {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = problemFilter.trim();
    if (trimmed) params.set("problemId", trimmed);
    window.location.search = params.toString();
  }

  let nextHref = $derived.by(() => {
    if (!data.nextCursor) return null;
    const params = new URLSearchParams();
    if (data.problemId) params.set("problemId", data.problemId);
    params.set("cursor", data.nextCursor);
    return `?${params.toString()}`;
  });
</script>

<PageContainer class="animate-in animate-in-2 space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-h3 font-semibold">{m.admin_rejudges_title()}</h1>
    <form class="flex items-center gap-2" onsubmit={applyFilter}>
      <Input
        class="h-9 w-56"
        bind:value={problemFilter}
        placeholder={m.admin_rejudges_filterProblem()}
      />
      <Button type="submit" size="sm" variant="outline">{m.admin_rejudges_filterBtn()}</Button>
    </form>
  </div>

  <Card class="space-y-3 p-4">
    <div>
      <h2 class="text-body font-semibold">{m.admin_rejudges_timeoutTitle()}</h2>
      <p class="text-body-sm text-muted-foreground">{m.admin_rejudges_timeoutHint()}</p>
    </div>
    <form
      class="flex flex-wrap items-end gap-3"
      method="POST"
      action="?/updatePendingTimeout"
      use:enhance={() => {
        savingTimeout = true;
        return async ({ result, update }) => {
          savingTimeout = false;
          await update({ reset: false });
          if (result.type === "success") {
            toasts.success(m.admin_rejudges_timeoutSaved());
          }
        };
      }}
    >
      <label class="space-y-1">
        <span class="block text-caption text-muted-foreground">
          {m.admin_rejudges_timeoutLabel()}
        </span>
        <Input
          type="number"
          name="pendingTimeoutMinutes"
          class="h-9 w-32"
          min="10"
          max="1440"
          step="1"
          required
          bind:value={pendingTimeout}
        />
      </label>
      <Button type="submit" size="sm" disabled={savingTimeout}>{m.common_save()}</Button>
    </form>
    {#if form?.error}
      <p class="text-body-sm text-destructive">{form.error}</p>
    {/if}
  </Card>

  {#if data.logs.length === 0}
    <p
      class="rounded-sm border border-border-subtle bg-muted/20 px-4 py-8 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_rejudges_empty()}
    </p>
  {:else}
    <div class="overflow-auto rounded-sm border border-border-subtle">
      <table class="w-full text-body-sm">
        <thead>
          <tr
            class="border-b border-border-subtle bg-muted/40 text-left text-caption uppercase tracking-wider text-muted-foreground"
          >
            <th class="px-3 py-2 font-medium">{m.admin_rejudges_colTime()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_rejudges_colSubmission()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_rejudges_colProblem()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_rejudges_colBy()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_rejudges_colChange()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.logs as log (log.id)}
            <tr class="border-b border-border-subtle last:border-b-0">
              <td class="px-3 py-2 text-caption text-muted-foreground whitespace-nowrap">
                {formatDateTime(log.createdAt)}
              </td>
              <td class="px-3 py-2">
                <a
                  class="font-mono text-caption hover:underline"
                  href="/submissions/{log.submissionId}"
                >
                  {log.submissionId.slice(0, 8)}
                </a>
              </td>
              <td class="px-3 py-2">
                <a class="hover:underline" href="/problems/{log.submission.problemId}">
                  {log.submission.problemId}
                </a>
              </td>
              <td class="px-3 py-2 text-caption">
                {log.rejudgedBy?.username ?? m.admin_rejudges_system()}
              </td>
              <td class="px-3 py-2 tabular-nums">
                <span class="text-muted-foreground">{log.oldVerdict} ({log.oldScore})</span>
                <span class="px-1">→</span>
                <span class="font-medium">{log.newVerdict ?? "—"} ({log.newScore ?? "—"})</span>
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
          {m.admin_rejudges_next()}
        </a>
      </div>
    {/if}
  {/if}
</PageContainer>
