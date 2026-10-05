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

  export interface ActiveSessionRow {
    userId: string;
    displayName: string;
    handle: string;
    startedAt: string;
  }

  export interface StudentProctoringRow {
    userId: string;
    submittedAt: string | null;
    ipPin: string | null;
    leaveAttempts: number;
  }
</script>

<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import type { ExamCredentialEntry } from "@nojv/core";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button, IconButton } from "$lib/components/primitives/ui/button";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import TableSortButton from "$lib/components/primitives/ui/TableSortButton.svelte";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import { formatDateTime } from "$lib/utils/datetime";
  import {
    ariaSort,
    sortDirection,
    sortRows,
    toggleSort,
    type TableSort,
  } from "$lib/utils/table-sort";

  interface Props {
    roster: ExamCredentialEntry[];
    violations: IpViolationRow[];
    activeSessions: ActiveSessionRow[];
    proctoring: StudentProctoringRow[];
    passwordEnabled: boolean;
    pageLockEnabled: boolean;
    ipBindingEnabled: boolean;
    canManage: boolean;
    canRegenerate: boolean;
  }

  let {
    roster,
    violations,
    activeSessions,
    proctoring,
    passwordEnabled,
    pageLockEnabled,
    ipBindingEnabled,
    canManage,
    canRegenerate,
  }: Props = $props();

  let studentFilter = $state("");
  let sessionFilter = $state("");
  let ipFilter = $state("");
  let ipPinFilter = $state("");
  let sort = $state<TableSort<"leaves">>({ key: "leaves", direction: "desc" });
  let busy = $state<string | null>(null);
  let failed = $state<string | null>(null);

  const rows = $derived.by(() => {
    const sessions = new Map(activeSessions.map((session) => [session.userId, session]));
    const students = new Map(proctoring.map((student) => [student.userId, student]));
    return roster.map((entry) => {
      const session = entry.userId ? sessions.get(entry.userId) : undefined;
      const student = entry.userId ? students.get(entry.userId) : undefined;
      return {
        ...entry,
        session,
        submittedAt: student?.submittedAt ?? null,
        state: session ? "active" : student?.submittedAt ? "submitted" : "idle",
        ipPin: student?.ipPin ?? null,
        leaveAttempts: student?.leaveAttempts ?? 0,
        violations: violations.filter((violation) => violation.userId === entry.userId),
      };
    });
  });
  const filtered = $derived.by(() => {
    const query = studentFilter.toLocaleLowerCase();
    return rows.filter(
      (row) =>
        `${row.username} ${row.name} ${row.email ?? ""}`.toLocaleLowerCase().includes(query) &&
        (!sessionFilter || sessionFilter === row.state) &&
        (!ipFilter || (ipFilter === "violation") === row.violations.length > 0) &&
        (!ipPinFilter ||
          (row.ipPin ?? "").toLocaleLowerCase().includes(ipPinFilter.toLocaleLowerCase())),
    );
  });
  const visible = $derived(
    pageLockEnabled ? sortRows(filtered, sort.direction, (row) => row.leaveAttempts) : filtered,
  );
  function typeLabel(type: IpViolationRow["violationType"]) {
    return type === "binding"
      ? m.examProctoring_typeBinding()
      : m.examProctoring_typeWhitelist();
  }
</script>

<section class="space-y-4">
  {#if rows.length === 0}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.examCredentials_empty()}
    </p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          <tr class="whitespace-nowrap border-b border-border-subtle text-left">
            <th class="py-3 pr-4 align-middle font-medium">
              <TableTextColumnFilter
                label={m.examProctoring_colStudent()}
                filterLabel={m.examCredentials_search()}
                inputId="exam-proctoring-student-filter"
                applyLabel={m.common_applyFilter()}
                bind:value={studentFilter}
              />
            </th>
            <th class="py-3 pr-4 align-middle font-medium">
              <TableSelectColumnFilter
                label={m.examProctoring_colSession()}
                filterLabel={m.examProctoring_colSession()}
                options={[
                  { value: "active", label: m.examProctoring_inExam() },
                  { value: "submitted", label: m.examProctoring_submitted() },
                  { value: "idle", label: m.examProctoring_notInExam() },
                ]}
                bind:value={sessionFilter}
              />
            </th>
            {#if pageLockEnabled}
              <th
                class="py-3 pr-4 align-middle font-medium"
                aria-sort={ariaSort(sortDirection(sort, "leaves"))}
              >
                <TableSortButton
                  label={m.examProctoring_colLeaves()}
                  direction={sortDirection(sort, "leaves")}
                  onclick={() => (sort = toggleSort(sort, "leaves"))}
                />
              </th>
            {/if}
            {#if ipBindingEnabled}
              <th class="py-3 pr-4 align-middle font-medium">
                <TableTextColumnFilter
                  label={m.examProctoring_colIpPin()}
                  filterLabel={m.examProctoring_colIpPin()}
                  inputId="exam-proctoring-ip-pin-filter"
                  applyLabel={m.common_applyFilter()}
                  bind:value={ipPinFilter}
                />
              </th>
            {/if}
            <th class="py-3 pr-4 align-middle font-medium">
              <TableSelectColumnFilter
                label={m.examProctoring_colIp()}
                filterLabel={m.examProctoring_colIp()}
                options={[
                  { value: "violation", label: m.examProctoring_hasViolations() },
                  { value: "clean", label: m.examProctoring_noViolations() },
                ]}
                bind:value={ipFilter}
              />
            </th>
            {#if passwordEnabled}
              <th class="py-3 pr-4 align-middle font-medium">{m.examCredentials_password()}</th>
            {/if}
            {#if canManage}
              <th class="py-3 align-middle font-medium">
                {m.examProctoring_colActions()}
              </th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if visible.length === 0}
            <tr>
              <td
                class="py-10 text-center text-muted-foreground"
                colspan={3 +
                  Number(pageLockEnabled) +
                  Number(ipBindingEnabled) +
                  Number(passwordEnabled) +
                  Number(canManage)}
              >
                {m.examCredentials_noMatches()}
              </td>
            </tr>
          {/if}
          {#each visible as row (row.membershipId)}
            <tr class="border-b border-border-subtle align-top last:border-b-0">
              <td class="py-3 pr-4">
                <p class="font-medium">{row.name}</p>
                <p class="mt-0.5 font-mono text-caption">{row.username}</p>
                {#if row.email}<p class="mt-0.5 text-caption text-muted-foreground">
                    {row.email}
                  </p>{/if}
              </td>
              <td class="py-3 pr-4">
                {#if row.session}
                  <Badge variant="success">{m.examProctoring_inExam()}</Badge>
                  <p
                    class="mt-1 whitespace-nowrap font-mono text-caption tabular-nums text-muted-foreground"
                  >
                    {formatDateTime(row.session.startedAt)}
                  </p>
                {:else if row.submittedAt}
                  <Badge variant="muted">{m.examProctoring_submitted()}</Badge>
                  <p
                    class="mt-1 whitespace-nowrap font-mono text-caption tabular-nums text-muted-foreground"
                  >
                    {formatDateTime(row.submittedAt)}
                  </p>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              {#if pageLockEnabled}
                <td class="py-3 pr-4 font-mono tabular-nums">
                  {#if row.leaveAttempts > 0}{row.leaveAttempts}{:else}<span
                      class="text-muted-foreground">—</span
                    >{/if}
                </td>
              {/if}
              {#if ipBindingEnabled}
                <td class="py-3 pr-4 font-mono">
                  {#if row.ipPin}{row.ipPin}{:else}<span class="text-muted-foreground">—</span
                    >{/if}
                </td>
              {/if}
              <td class="py-3 pr-4">
                {#if row.violations[0]}
                  {@const latest = row.violations[0]}
                  <div class="flex items-center gap-1.5">
                    <Badge
                      variant={latest.violationType === "binding" ? "destructive" : "warning"}
                    >
                      {typeLabel(latest.violationType)}
                    </Badge>
                    <Popover.Root>
                      <Popover.Trigger
                        type="button"
                        class="focus-ring rounded-sm px-1 font-mono text-caption text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={m.examProctoring_violationHistory({
                          count: row.violations.length,
                        })}>×{row.violations.length}</Popover.Trigger
                      >
                      <Popover.Portal>
                        <Popover.Content
                          sideOffset={6}
                          align="start"
                          class="z-50 max-h-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
                        >
                          <table class="text-caption">
                            <thead class="text-left text-muted-foreground">
                              <tr>
                                <th class="pb-1 pr-3 font-medium"
                                  >{m.examProctoring_colTime()}</th
                                >
                                <th class="pb-1 pr-3 font-medium"
                                  >{m.examProctoring_colType()}</th
                                >
                                <th class="pb-1 pr-3 font-medium"
                                  >{m.examProctoring_colExpected()}</th
                                >
                                <th class="pb-1 font-medium">{m.examProctoring_colActual()}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each row.violations as violation (violation.id)}
                                <tr>
                                  <td class="py-1 pr-3 font-mono tabular-nums"
                                    >{formatDateTime(violation.createdAt)}</td
                                  >
                                  <td class="py-1 pr-3">{typeLabel(violation.violationType)}</td
                                  >
                                  <td class="py-1 pr-3 font-mono"
                                    >{violation.expectedIp ?? "—"}</td
                                  >
                                  <td class="py-1 font-mono">{violation.actualIp}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                  <p
                    class="mt-1 whitespace-nowrap font-mono text-caption text-muted-foreground"
                  >
                    {latest.violationType === "binding"
                      ? `${latest.expectedIp ?? "—"} → ${latest.actualIp}`
                      : latest.actualIp}
                  </p>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              {#if passwordEnabled}
                <td class="py-3 pr-4">
                  <div class="flex items-center gap-1">
                    {#if row.password}<code class="select-all whitespace-nowrap font-mono"
                        >{row.password}</code
                      >{:else}<span class="text-muted-foreground">—</span>{/if}
                    {#if canRegenerate && row.userId && row.status !== "expired" && row.status !== "unavailable"}
                      <form
                        method="POST"
                        action="?/regenerateCredentialPassword"
                        use:enhance={({ cancel }) => {
                          if (
                            !confirm(
                              m.examCredentials_regenerateConfirm({ username: row.username }),
                            )
                          ) {
                            cancel();
                            return;
                          }
                          busy = row.userId;
                          failed = null;
                          return async ({ result, update }) => {
                            busy = null;
                            if (result.type === "success") await update();
                            else failed = row.userId;
                          };
                        }}
                      >
                        <input type="hidden" name="userId" value={row.userId} />
                        <IconButton
                          type="submit"
                          size="sm"
                          label={m.examCredentials_regenerate()}
                          title={m.examCredentials_regenerate()}
                          loading={busy === row.userId}
                          disabled={busy !== null}
                        >
                          <RefreshCw class="size-4" aria-hidden="true" />
                        </IconButton>
                      </form>
                    {/if}
                  </div>
                  {#if row.userId && failed === row.userId}<p
                      role="alert"
                      class="mt-1 text-caption text-destructive"
                    >
                      {m.examCredentials_regenerateFailed()}
                    </p>{/if}
                </td>
              {/if}
              {#if canManage}
                <td class="py-3">
                  {#if row.userId}
                    <div class="flex gap-2">
                      {#if row.state !== "submitted" && (row.ipPin || row.violations.length > 0)}
                        <form method="POST" action="?/resetStudentIpBinding" use:enhance>
                          <input type="hidden" name="targetUserId" value={row.userId} />
                          <Button type="submit" variant="outline" size="sm"
                            >{m.examProctoring_resetIpBinding()}</Button
                          >
                        </form>
                      {/if}
                      {#if pageLockEnabled && row.session}
                        <form method="POST" action="?/releaseStudentSession" use:enhance>
                          <input type="hidden" name="targetUserId" value={row.userId} />
                          <Button type="submit" variant="outline" size="sm"
                            >{m.examProctoring_release()}</Button
                          >
                        </form>
                      {/if}
                    </div>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
