<script lang="ts">
  import { enhance } from "$app/forms";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import * as Select from "$lib/components/primitives/ui/select";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDate } from "$lib/utils/datetime";
  import { Flag, Search } from "@lucide/svelte";

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
      <div class="flex flex-wrap items-end gap-3 border-b border-border-subtle p-4">
        <label class="min-w-56 flex-1 text-caption font-medium text-muted-foreground">
          {m.adminReports_filterSearch()}
          <span class="relative mt-1 block">
            <Search
              class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-body-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              type="search"
              bind:value={search}
              placeholder={m.adminReports_filterSearch()}
            />
          </span>
        </label>
        <div class="min-w-44">
          <span class="text-caption font-medium text-muted-foreground"
            >{m.adminReports_colType()}</span
          >
          <Select.Root
            type="single"
            value={typeFilter || "__all"}
            onValueChange={(value) => (typeFilter = value === "__all" ? "" : value)}
          >
            <Select.Trigger class="mt-1 h-9 w-full border-transparent bg-transparent px-2">
              {typeFilter
                ? typeLabel(typeFilter as "editorial" | "discussion" | "comment")
                : m.adminReports_filterAll()}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__all">{m.adminReports_filterAll()}</Select.Item>
              <Select.Item value="editorial">{m.adminReports_typeEditorial()}</Select.Item>
              <Select.Item value="discussion">{m.adminReports_typeDiscussion()}</Select.Item>
              <Select.Item value="comment">{m.adminReports_typeComment()}</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>
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
              <th class="px-3 py-2 font-medium">{m.adminReports_colReported()}</th>
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
                <td class="max-w-xs px-3 py-3">
                  <span class="font-medium">{report.preview}</span>
                  {#if report.postTitle}
                    <span class="text-muted-foreground"> · {report.postTitle}</span>
                  {/if}
                  {#if report.targetDeleted}
                    <span class="text-caption text-muted-foreground">
                      · {m.adminReports_deletedTarget()}</span
                    >
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
                <td class="px-3 py-3 tabular-nums text-muted-foreground">
                  {formatDate(report.createdAt)}
                </td>
              </tr>
            {/each}
            {#if filteredReports.length === 0}
              <tr
                ><td
                  colspan="7"
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
              class="rounded-md bg-destructive px-3 py-1.5 text-caption font-medium text-destructive-foreground hover:bg-destructive/90"
              >{m.adminReports_resolve()}</button
            >
          </form>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
