<script lang="ts">
  import { enhance } from "$app/forms";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDate } from "$lib/utils/datetime";
  import { Flag } from "@lucide/svelte";

  let { data } = $props();
  let search = $state("");
  let typeFilter = $state("");
  let selected = $state<(typeof data.reports)[number] | null>(null);
  let detailOpen = $state(false);

  function typeLabel(type: "editorial" | "discussion" | "comment"): string {
    if (type === "editorial") return m.adminReports_typeEditorial();
    if (type === "discussion") return m.adminReports_typeDiscussion();
    return m.adminReports_typeComment();
  }

  const filteredReports = $derived(
    data.reports.filter((report) => {
      if (typeFilter && report.targetType !== typeFilter) return false;
      if (!search.trim()) return true;
      const query = search.trim().toLocaleLowerCase();
      return [report.preview, report.postTitle, report.authorName, report.reporterName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query));
    }),
  );

  function openReport(report: (typeof data.reports)[number]) {
    selected = report;
    detailOpen = true;
  }
</script>

<PageContainer>
  <PageHeader
    eyebrow={m.adminReports_eyebrow()}
    title={m.adminReports_title()}
    description={m.adminReports_subtitle()}
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
              class="border-b border-border-subtle text-left text-caption whitespace-nowrap text-muted-foreground"
            >
              <th class="px-3 py-3 align-middle font-medium">
                <TableSelectColumnFilter
                  label={m.adminReports_colType()}
                  filterLabel={m.adminReports_filterType()}
                  allLabel={m.adminReports_filterAll()}
                  options={[
                    { value: "editorial", label: m.adminReports_typeEditorial() },
                    { value: "discussion", label: m.adminReports_typeDiscussion() },
                    { value: "comment", label: m.adminReports_typeComment() },
                  ]}
                  bind:value={typeFilter}
                />
              </th>
              <th class="px-3 py-3 align-middle font-medium">
                <TableTextColumnFilter
                  label={m.adminReports_colContent()}
                  filterLabel={m.adminReports_filterSearch()}
                  inputId="admin-reports-search-filter"
                  applyLabel={m.common_applyFilter()}
                  bind:value={search}
                />
              </th>
              <th class="px-3 py-3 align-middle font-medium">{m.adminReports_colProblem()}</th>
              <th class="px-3 py-3 align-middle font-medium">{m.adminReports_colAuthor()}</th>
              <th class="px-3 py-3 align-middle font-medium">{m.adminReports_colReporter()}</th>
              <th class="px-3 py-3 align-middle font-medium">{m.adminReports_colReported()}</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredReports as report (report.id)}
              <tr
                class="cursor-pointer border-b border-border-subtle align-top transition-colors hover:bg-muted/30"
                role="button"
                tabindex="0"
                onclick={() => openReport(report)}
                onkeydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openReport(report);
                  }
                }}
              >
                <td class="px-3 py-3">
                  <span class="font-medium">{typeLabel(report.targetType)}</span>
                </td>
                <td class="px-3 py-3 text-caption text-muted-foreground">
                  <span aria-hidden="true">—</span>
                  <span class="sr-only">{m.adminReports_colContent()}</span>
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
                <td class="px-3 py-3 tabular-nums text-muted-foreground">
                  {formatDate(report.createdAt)}
                </td>
              </tr>
            {/each}
            {#if filteredReports.length === 0}
              <tr
                ><td
                  colspan="6"
                  class="px-4 py-10 text-center text-body-sm text-muted-foreground"
                  >{m.submissions_noMatches()}</td
                ></tr
              >
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>
</PageContainer>

<Dialog.Root bind:open={detailOpen}>
  <Dialog.Content showCloseButton class="max-w-xl">
    {#if selected}
      <Dialog.Header>
        <Dialog.Title>{typeLabel(selected.targetType)}</Dialog.Title>
        <Dialog.Description
          >{selected.reporterName} · {formatDate(selected.createdAt)}</Dialog.Description
        >
      </Dialog.Header>
      <div class="space-y-4 text-body-sm">
        <div>
          <p class="text-caption font-medium text-muted-foreground">
            {m.adminReports_colContent()}
          </p>
          <p class="mt-1 whitespace-pre-wrap text-foreground">{selected.preview}</p>
          {#if selected.postTitle}<p class="mt-1 text-muted-foreground">
              {selected.postTitle}
            </p>{/if}
        </div>
        <div>
          <p class="text-caption font-medium text-muted-foreground">
            {m.adminReports_colReason()}
          </p>
          <p class="mt-1 whitespace-pre-wrap text-foreground">{selected.reason}</p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <p>
            <span class="text-muted-foreground">{m.adminReports_colAuthor()}:</span>
            {selected.authorName}
          </p>
          <p>
            <span class="text-muted-foreground">{m.adminReports_colReporter()}:</span>
            {selected.reporterName}
          </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-4">
          <form
            method="POST"
            action="?/dismiss"
            use:enhance={({ cancel }) => {
              if (!confirm(m.adminReports_dismissConfirm())) cancel();
            }}
          >
            <input type="hidden" name="id" value={selected.id} />
            <button
              type="submit"
              class="rounded-md border border-border px-3 py-1.5 text-caption font-medium text-muted-foreground hover:border-border-strong hover:text-foreground"
              >{m.adminReports_dismiss()}</button
            >
          </form>
          <form
            method="POST"
            action="?/resolve"
            use:enhance={({ cancel }) => {
              if (!confirm(m.adminReports_resolveConfirm())) cancel();
            }}
          >
            <input type="hidden" name="id" value={selected.id} />
            <button
              type="submit"
              class="rounded-md bg-destructive px-3 py-1.5 text-caption font-medium text-white hover:bg-destructive/90"
              >{m.adminReports_resolve()}</button
            >
          </form>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
