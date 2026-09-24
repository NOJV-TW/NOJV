<script lang="ts" module>
  import type { ExamCredentialEntry } from "@nojv/core";
  export type ExamCredentialRow = ExamCredentialEntry;
</script>

<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Input } from "$lib/components/primitives/ui/input";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { formatDateTime } from "$lib/utils/datetime";
  import { m } from "$lib/paraglide/messages.js";

  let {
    rows,
    startsAt,
    enabled,
    canEdit,
    canResetIp,
  }: {
    rows: ExamCredentialRow[];
    startsAt: string;
    enabled: boolean;
    canEdit: boolean;
    canResetIp: boolean;
  } = $props();
  let search = $state("");
  let editing = $state<string | null>(null);
  let password = $state("");
  let busy = $state<string | null>(null);
  let feedback = $state<{ userId: string; text: string; error: boolean } | null>(null);
  $effect(() => {
    if (!canEdit || !enabled) {
      editing = null;
      password = "";
    }
  });
  const filtered = $derived(
    rows.filter((row) =>
      `${row.username} ${row.name} ${row.email ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    ),
  );
  const issueAt = $derived(
    formatDateTime(new Date(new Date(startsAt).getTime() - 86_400_000).toISOString()),
  );

  function statusLabel(status: ExamCredentialRow["status"]) {
    switch (status) {
      case "pending_account":
        return m.examCredentials_pendingAccount();
      case "not_issued":
        return m.examCredentials_notIssued();
      case "ready":
        return m.examCredentials_ready();
      case "email_pending":
        return m.examCredentials_emailPending();
      case "email_sent":
        return m.examCredentials_emailSent();
      case "email_failed":
        return m.examCredentials_emailFailed();
      case "email_unavailable":
        return m.examCredentials_emailUnavailable();
      case "expired":
        return m.examCredentials_expired();
      case "unavailable":
        return m.examCredentials_unavailable();
    }
  }
</script>

<section class="space-y-5" aria-labelledby="exam-credentials-title">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="max-w-prose">
      <h2 id="exam-credentials-title" class="text-title font-semibold">
        {m.examCredentials_title()}
      </h2>
      {#if enabled}
        <p class="mt-1 text-body-sm text-muted-foreground">
          {m.examCredentials_schedule({ at: issueAt })}
        </p>
        <p class="mt-1 text-body-sm text-muted-foreground">{m.examCredentials_editHint()}</p>
      {:else}
        <p role="status" class="mt-1 text-body-sm text-muted-foreground">
          {m.examPassword_disabled()}
        </p>
      {/if}
    </div>
    <div class="w-full sm:w-60">
      <label for="exam-credential-search" class="sr-only">{m.examCredentials_search()}</label>
      <Input
        id="exam-credential-search"
        type="search"
        bind:value={search}
        placeholder={m.examCredentials_search()}
      />
    </div>
  </header>
  {#if rows.length === 0}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.examCredentials_empty()}
    </p>
  {:else if filtered.length === 0}
    <p class="py-8 text-center text-body-sm text-muted-foreground">
      {m.examCredentials_noMatches()}
    </p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead>
          <tr
            class="border-b border-border-subtle text-left text-caption text-muted-foreground"
          >
            <th class="py-3 pr-4 font-medium">{m.examProctoring_colStudent()}</th>
            <th class="py-3 pr-4 font-medium">{m.examCredentials_password()}</th>
            <th class="py-3 pr-4 font-medium">{m.examCredentials_delivery()}</th>
            <th class="py-3 text-right font-medium">{m.examCredentials_access()}</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row (row.membershipId)}
            <tr class="border-b border-border-subtle align-top last:border-b-0">
              <td class="py-4 pr-4">
                <p class="font-medium">{row.name}</p>
                <p class="mt-0.5 font-mono text-caption">{row.username}</p>
                {#if row.email}<p class="mt-1 text-caption text-muted-foreground">
                    {row.email}
                  </p>{/if}
              </td>
              <td class="min-w-52 py-4 pr-4">
                {#if editing === row.userId && row.userId}
                  <form
                    method="POST"
                    action="?/updateCredentialPassword"
                    class="space-y-2"
                    use:enhance={() => {
                      busy = row.userId;
                      feedback = null;
                      return async ({ result, update }) => {
                        busy = null;
                        if (result.type === "success") {
                          editing = null;
                          password = "";
                          feedback = {
                            userId: row.userId!,
                            text: m.common_saved(),
                            error: false,
                          };
                          await update();
                        } else
                          feedback = {
                            userId: row.userId!,
                            text: m.examCredentials_saveFailed(),
                            error: true,
                          };
                      };
                    }}
                  >
                    <input type="hidden" name="userId" value={row.userId} />
                    <label class="sr-only" for={`exam-password-${row.membershipId}`}
                      >{m.examCredentials_passwordFor({ username: row.username })}</label
                    >
                    <Input
                      id={`exam-password-${row.membershipId}`}
                      name="password"
                      bind:value={password}
                      autocomplete="new-password"
                      minlength={12}
                      maxlength={64}
                      required
                      disabled={busy === row.userId}
                    />
                    <div class="flex gap-2">
                      <Button type="submit" size="sm" loading={busy === row.userId}
                        >{m.common_save()}</Button
                      >
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === row.userId}
                        onclick={() => {
                          editing = null;
                          password = "";
                        }}>{m.common_cancel()}</Button
                      >
                    </div>
                  </form>
                {:else}
                  <div class="flex flex-wrap items-center gap-2">
                    {#if enabled && row.password}<code class="select-all break-all font-mono"
                        >{row.password}</code
                      >{:else}<span class="text-muted-foreground">—</span>{/if}
                    {#if enabled && canEdit && row.userId && row.status !== "expired" && row.status !== "unavailable"}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onclick={() => {
                          editing = row.userId;
                          password = row.password ?? "";
                          feedback = null;
                        }}>{m.examCredentials_edit()}</Button
                      >
                    {/if}
                  </div>
                {/if}
                {#if feedback?.userId === row.userId}<p
                    role={feedback.error ? "alert" : "status"}
                    class="mt-2 text-caption {feedback.error
                      ? 'text-destructive'
                      : 'text-success'}"
                  >
                    {feedback.text}
                  </p>{/if}
              </td>
              <td class="py-4 pr-4">
                <Badge variant={row.status === "email_failed" ? "destructive" : "outline"}
                  >{statusLabel(row.status)}</Badge
                >
                {#if row.emailSentAt}<p class="mt-1 text-caption text-muted-foreground">
                    {formatDateTime(row.emailSentAt)}
                  </p>{/if}
                {#if row.status === "pending_account"}<p
                    class="mt-1 max-w-60 text-caption text-muted-foreground"
                  >
                    {m.examCredentials_pendingAccountHint()}
                  </p>{/if}
                {#if row.status === "email_unavailable"}<p
                    class="mt-1 max-w-60 text-caption text-muted-foreground"
                  >
                    {m.examCredentials_emailUnavailableHint()}
                  </p>{/if}
              </td>
              <td class="py-4 text-right">
                {#if row.userId && canResetIp}
                  <form method="POST" action="?/resetStudentIpBinding" use:enhance>
                    <input type="hidden" name="targetUserId" value={row.userId} />
                    <Button type="submit" variant="outline" size="sm"
                      >{m.examProctoring_resetIpBinding()}</Button
                    >
                  </form>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
