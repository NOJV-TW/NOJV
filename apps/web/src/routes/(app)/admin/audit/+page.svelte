<script lang="ts">
  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  type AuditAction = PageData["entries"][number]["action"];

  let { data }: { data: PageData } = $props();

  function actionLabel(action: AuditAction): string {
    switch (action) {
      case "user_role_change":
        return m.admin_audit_actionUserRoleChange();
      case "user_disable":
        return m.admin_audit_actionUserDisable();
      case "user_enable":
        return m.admin_audit_actionUserEnable();
      case "user_delete":
        return m.admin_audit_actionUserDelete();
      case "editorial_report_resolve":
        return m.admin_audit_actionEditorialReportResolve();
      case "editorial_report_dismiss":
        return m.admin_audit_actionEditorialReportDismiss();
      case "announcement_create":
        return m.admin_audit_actionAnnouncementCreate();
      case "announcement_delete":
        return m.admin_audit_actionAnnouncementDelete();
    }
  }

  let nextHref = $derived(data.nextCursor ? `?cursor=${data.nextCursor}` : null);
</script>

<PageContainer class="animate-in animate-in-2 space-y-4">
  <h1 class="text-title-lg font-semibold">{m.admin_audit_title()}</h1>

  {#if data.entries.length === 0}
    <p
      class="rounded-sm border border-border-subtle bg-muted/20 px-4 py-8 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_audit_empty()}
    </p>
  {:else}
    <div class="overflow-auto rounded-sm border border-border-subtle">
      <table class="w-full text-body-sm">
        <thead>
          <tr
            class="border-b border-border-subtle bg-muted/40 text-left text-caption uppercase tracking-wider text-muted-foreground"
          >
            <th class="px-3 py-2 font-medium">{m.admin_audit_colTime()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_audit_colActor()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_audit_colAction()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_audit_colTarget()}</th>
            <th class="px-3 py-2 font-medium">{m.admin_audit_colSummary()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as entry (entry.id)}
            <tr class="border-b border-border-subtle last:border-b-0">
              <td class="px-3 py-2 text-caption text-muted-foreground whitespace-nowrap">
                {formatDateTime(entry.createdAt)}
              </td>
              <td class="px-3 py-2">{entry.actorName}</td>
              <td class="px-3 py-2">
                <Badge variant="muted" size="sm">{actionLabel(entry.action)}</Badge>
              </td>
              <td class="px-3 py-2 text-caption text-muted-foreground">
                {entry.targetType ?? "—"}
              </td>
              <td class="px-3 py-2">{entry.summary}</td>
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
          {m.admin_audit_next()}
        </a>
      </div>
    {/if}
  {/if}
</PageContainer>
