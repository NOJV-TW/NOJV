<script lang="ts" module>
  export interface IpViolationRow {
    id: string;
    userId: string;
    handle: string;
    displayName: string;
    violationType: "whitelist" | "binding";
    expectedIp: string | null;
    actualIp: string;
    createdAt: string;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    violations: IpViolationRow[];
    class?: string;
  }

  let { violations, class: className }: Props = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString();
  }
</script>

<Card class={className}>
  <div class="flex items-center justify-between gap-3">
    <div>
      <h2 class="text-title font-semibold">
        {m.examProctoring_title()}
      </h2>
      <p class="text-body-sm text-muted-foreground">
        {m.examProctoring_subtitle()}
      </p>
    </div>
    <Badge variant="outline" size="sm">
      {m.examProctoring_count({ count: violations.length })}
    </Badge>
  </div>

  {#if violations.length === 0}
    <div
      class="rounded-md border border-dashed border-border bg-[color:var(--color-panel)]/40 p-8 text-center text-body-sm text-muted-foreground"
    >
      {m.examProctoring_emptyState()}
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead>
          <tr class="border-b border-border text-left text-caption text-muted-foreground">
            <th class="py-2 pr-3 font-medium">{m.examProctoring_colTime()}</th>
            <th class="py-2 pr-3 font-medium">{m.examProctoring_colStudent()}</th>
            <th class="py-2 pr-3 font-medium">{m.examProctoring_colType()}</th>
            <th class="py-2 pr-3 font-medium">{m.examProctoring_colExpected()}</th>
            <th class="py-2 font-medium">{m.examProctoring_colActual()}</th>
          </tr>
        </thead>
        <tbody>
          {#each violations as v (v.id)}
            <tr class="border-b border-border/40 last:border-b-0">
              <td class="py-2 pr-3 font-mono text-caption tabular-nums">
                {formatDate(v.createdAt)}
              </td>
              <td class="py-2 pr-3">
                <div class="flex flex-col leading-tight">
                  <span class="font-medium">{v.displayName}</span>
                  <span class="text-caption text-muted-foreground">{v.handle}</span>
                </div>
              </td>
              <td class="py-2 pr-3">
                <Badge
                  variant={v.violationType === "binding" ? "destructive" : "outline"}
                  size="sm"
                >
                  {v.violationType === "binding"
                    ? m.examProctoring_typeBinding()
                    : m.examProctoring_typeWhitelist()}
                </Badge>
              </td>
              <td class="py-2 pr-3 font-mono text-caption">
                {v.expectedIp ?? "—"}
              </td>
              <td class="py-2 font-mono text-caption">{v.actualIp}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>
