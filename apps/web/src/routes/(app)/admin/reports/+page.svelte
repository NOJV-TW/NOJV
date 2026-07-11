<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDate } from "$lib/utils/datetime";
  import { Flag } from "@lucide/svelte";

  let { data } = $props();

  function typeLabel(type: "editorial" | "discussion" | "comment"): string {
    if (type === "editorial") return m.adminReports_typeEditorial();
    if (type === "discussion") return m.adminReports_typeDiscussion();
    return m.adminReports_typeComment();
  }
</script>

{#snippet reportsActions()}
  <Badge variant="muted" size="sm">{data.reports.length}</Badge>
{/snippet}

<PageContainer>
  <PageHeader
    eyebrow={m.adminReports_eyebrow()}
    title={m.adminReports_title()}
    description={m.adminReports_subtitle()}
    actions={reportsActions}
  />

  <Card variant="surface" size="lg">
    {#if data.reports.length === 0}
      <EmptyState
        variant="onboarding"
        icon={Flag}
        title={m.adminReports_empty()}
        description={m.adminReports_emptyHint()}
      />
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead>
            <tr
              class="border-b border-border-subtle text-left text-caption text-muted-foreground"
            >
              <th class="px-3 py-2 font-medium">{m.adminReports_colType()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colContent()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colProblem()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colAuthor()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colReporter()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colReason()}</th>
              <th class="px-3 py-2 font-medium">{m.adminReports_colReported()}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.reports as report (report.id)}
              <tr class="border-b border-border-subtle align-top">
                <td class="px-3 py-3">
                  <Badge variant="muted" size="xs">{typeLabel(report.targetType)}</Badge>
                </td>
                <td class="max-w-xs px-3 py-3">
                  <span class="font-medium">{report.preview}</span>
                  {#if report.postTitle}
                    <span class="text-muted-foreground"> · {report.postTitle}</span>
                  {/if}
                  {#if report.targetDeleted}
                    <Badge variant="muted" size="xs">{m.adminReports_deletedTarget()}</Badge>
                  {/if}
                </td>
                <td class="px-3 py-3">
                  <a
                    class="text-primary hover:underline"
                    href={`/problems/${report.problem.id}`}
                  >
                    <span class="font-medium"
                      >{report.problem.displayId ?? m.common_problemDraft()}</span
                    >
                    <span class="text-muted-foreground"> · {report.problem.title}</span>
                  </a>
                </td>
                <td class="px-3 py-3">{report.authorName}</td>
                <td class="px-3 py-3">{report.reporterName}</td>
                <td class="max-w-xs px-3 py-3 whitespace-pre-wrap">{report.reason}</td>
                <td class="px-3 py-3 tabular-nums text-muted-foreground">
                  {formatDate(report.createdAt)}
                </td>
                <td class="px-3 py-3">
                  <div class="flex items-center justify-end gap-2">
                    <form
                      method="POST"
                      action="?/resolve"
                      use:enhance={({ cancel }) => {
                        if (!confirm(m.adminReports_resolveConfirm())) {
                          cancel();
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={report.id} />
                      <button
                        type="submit"
                        class="rounded-md bg-destructive px-3 py-1.5 text-caption font-medium text-destructive-foreground transition-[background-color] duration-fast ease-out-soft hover:bg-destructive/90"
                      >
                        {m.adminReports_resolve()}
                      </button>
                    </form>
                    <form
                      method="POST"
                      action="?/dismiss"
                      use:enhance={({ cancel }) => {
                        if (!confirm(m.adminReports_dismissConfirm())) {
                          cancel();
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={report.id} />
                      <button
                        type="submit"
                        class="rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors duration-fast ease-out-soft hover:border-border-strong hover:text-foreground"
                      >
                        {m.adminReports_dismiss()}
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
</PageContainer>
