<script lang="ts">
  import { History } from "@lucide/svelte";
  import type { auditDomain } from "@nojv/application";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import type { BadgeVariant } from "$lib/components/primitives/ui/badge";

  type AuditEvent = auditDomain.AuditEvent;

  interface Props {
    events: AuditEvent[];
    actorNames: Record<string, string>;
  }

  let { events, actorNames }: Props = $props();

  function actorLabel(actorUserId: string | null): string {
    if (actorUserId === null) return m.audit_unknownActor();
    return actorNames[actorUserId] ?? m.audit_unknownActor();
  }

  function kindLabel(kind: AuditEvent["kind"]): string {
    switch (kind) {
      case "lifecycle":
        return m.audit_kindLifecycle();
      case "score_override":
        return m.audit_kindScoreOverride();
      case "rejudge":
        return m.audit_kindRejudge();
    }
  }

  function kindVariant(kind: AuditEvent["kind"]): BadgeVariant {
    switch (kind) {
      case "lifecycle":
        return "info";
      case "score_override":
        return "warning";
      case "rejudge":
        return "secondary";
    }
  }

  function score(value: number | null): string {
    return value === null ? "—" : String(value);
  }

  function lifecycleDetail(detail: auditDomain.LifecycleAuditEvent["detail"]): string {
    switch (detail.action) {
      case "publish":
        return m.audit_detailLifecyclePublish();
      case "revert_to_draft":
        return m.audit_detailLifecycleRevertToDraft();
      case "delete_draft":
        return m.audit_detailLifecycleDeleteDraft();
    }
  }

  function scoreOverrideDetail(detail: auditDomain.ScoreOverrideAuditEvent["detail"]): string {
    switch (detail.action) {
      case "create":
        return m.audit_detailScoreOverrideCreate({ newScore: score(detail.newScore) });
      case "update":
        return m.audit_detailScoreOverrideUpdate({
          oldScore: score(detail.oldScore),
          newScore: score(detail.newScore),
        });
      case "delete":
        return m.audit_detailScoreOverrideDelete({ oldScore: score(detail.oldScore) });
    }
  }
</script>

{#if events.length === 0}
  <EmptyState icon={History} title={m.audit_emptyTitle()} description={m.audit_emptyBody()} />
{:else}
  <ol class="border-l border-border">
    {#each events as event, i (i)}
      <li class="relative pb-5 pl-6 last:pb-0">
        <span
          class="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-background bg-border-strong"
          aria-hidden="true"
        ></span>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={kindVariant(event.kind)} size="sm">
            {kindLabel(event.kind)}
          </Badge>
          <span class="text-body-sm font-medium">{actorLabel(event.actorUserId)}</span>
          <span class="text-caption text-muted-foreground tabular-nums">
            {formatDateTime(event.at)}
          </span>
        </div>
        <p class="mt-1 text-body-sm text-muted-foreground">
          {#if event.kind === "lifecycle"}
            {lifecycleDetail(event.detail)}
          {:else if event.kind === "score_override"}
            {scoreOverrideDetail(event.detail)}
          {:else if event.kind === "rejudge"}
            {m.audit_detailRejudgeVerdict({
              oldVerdict: event.detail.oldVerdict ?? "—",
              newVerdict: event.detail.newVerdict ?? "—",
            })}
            {#if event.detail.oldScore !== event.detail.newScore}
              · {m.audit_detailRejudgeScore({
                oldScore: score(event.detail.oldScore),
                newScore: score(event.detail.newScore),
              })}
            {/if}
          {/if}
        </p>
      </li>
    {/each}
  </ol>
{/if}
