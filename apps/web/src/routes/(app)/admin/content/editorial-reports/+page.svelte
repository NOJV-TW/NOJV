<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Flag } from "@lucide/svelte";

  let { data } = $props();
</script>

{#snippet reportsActions()}
  <Badge variant="muted" size="sm">{data.reports.length}</Badge>
{/snippet}

<PageHeader
  eyebrow={m.adminEditorialReports_eyebrow()}
  title={m.adminEditorialReports_title()}
  description={m.adminEditorialReports_subtitle()}
  actions={reportsActions}
/>

<Card variant="surface" size="lg">
  {#if data.reports.length === 0}
    <EmptyState
      variant="onboarding"
      icon={Flag}
      title={m.adminEditorialReports_empty()}
      description={m.adminEditorialReports_emptyHint()}
    />
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead>
          <tr class="border-b border-border text-left text-caption text-muted-foreground">
            <th class="px-3 py-2 font-medium">{m.adminEditorialReports_colProblem()}</th>
            <th class="px-3 py-2 font-medium">{m.adminEditorialReports_colAuthor()}</th>
            <th class="px-3 py-2 font-medium">{m.adminEditorialReports_colReporter()}</th>
            <th class="px-3 py-2 font-medium">{m.adminEditorialReports_colReason()}</th>
            <th class="px-3 py-2 font-medium">{m.adminEditorialReports_colReported()}</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each data.reports as report (report.id)}
            <tr class="border-b border-border-subtle align-top">
              <td class="px-3 py-3">
                <span class="font-medium">{report.problem.displayId}</span>
                <span class="text-muted-foreground"> · {report.problem.title}</span>
                {#if report.editorialDeleted}
                  <Badge variant="muted" size="xs">
                    {m.adminEditorialReports_deletedEditorial()}
                  </Badge>
                {/if}
              </td>
              <td class="px-3 py-3">{report.authorName}</td>
              <td class="px-3 py-3">{report.reporterName}</td>
              <td class="max-w-xs px-3 py-3 whitespace-pre-wrap">{report.reason}</td>
              <td class="px-3 py-3 tabular-nums text-muted-foreground">
                {new Date(report.createdAt).toLocaleDateString()}
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center justify-end gap-2">
                  <form
                    method="POST"
                    action="?/resolve"
                    use:enhance={({ cancel }) => {
                      if (!confirm(m.adminEditorialReports_resolveConfirm())) {
                        cancel();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      class="rounded-md bg-destructive px-3 py-1.5 text-caption font-medium text-destructive-foreground transition-[background-color] duration-fast ease-out-soft hover:bg-destructive/90"
                    >
                      {m.adminEditorialReports_resolve()}
                    </button>
                  </form>
                  <form
                    method="POST"
                    action="?/dismiss"
                    use:enhance={({ cancel }) => {
                      if (!confirm(m.adminEditorialReports_dismissConfirm())) {
                        cancel();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      class="rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors duration-fast ease-out-soft hover:border-border-strong hover:text-foreground"
                    >
                      {m.adminEditorialReports_dismiss()}
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>
