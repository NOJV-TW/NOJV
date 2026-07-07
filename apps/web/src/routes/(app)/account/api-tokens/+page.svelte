<script lang="ts">
  import { KeyRound, RotateCw, ShieldOff, Save } from "@lucide/svelte";

  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Card } from "$lib/components/primitives/ui/card";

  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  function formatDate(value: string | null): string {
    return value ? formatDateTime(value) : m.apiTokens_never();
  }

  function resolveActionError(key: string): string {
    switch (key) {
      case "forbidden":
        return m.apiTokens_errorForbidden();
      case "notFound":
        return m.apiTokens_errorNotFound();
      case "invalid":
        return m.apiTokens_errorInvalid();
      default:
        return m.apiTokens_errorUnexpected();
    }
  }

  const plaintextToken = $derived(
    form && "token" in form && typeof form.token === "string" ? form.token : null,
  );

  const actionError = $derived(
    form && "errorKey" in form && typeof form.errorKey === "string"
      ? resolveActionError(form.errorKey)
      : null,
  );
</script>

<PageContainer width="full">
  <Section>
    {#snippet header()}
      <div class="flex flex-col gap-2">
        <a href="/account" class="text-body-sm text-muted-foreground hover:text-foreground">
          {m.navigation_account()}
        </a>
        <h1 class="text-title-lg">{m.apiTokens_title()}</h1>
        <p>{m.apiTokens_subtitle()}</p>
      </div>
    {/snippet}

    <div class="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div class="flex flex-col gap-4">
        {#if plaintextToken}
          <Card variant="strong" size="md" class="border-success/40">
            <div class="flex items-center gap-2">
              <KeyRound aria-hidden="true" class="h-4 w-4 text-success" />
              <h2 class="text-title-sm">{m.apiTokens_copyNowTitle()}</h2>
            </div>
            <p class="text-body-sm text-muted-foreground">
              {m.apiTokens_copyNowHint()}
            </p>
            <code
              class="break-all rounded-md border border-border bg-background p-3 text-body-sm"
            >
              {plaintextToken}
            </code>
          </Card>
        {/if}

        {#if actionError}
          <Card variant="surface" size="sm" class="border-destructive/50">
            <p class="text-body-sm text-destructive">{actionError}</p>
          </Card>
        {/if}

        <Card variant="surface" size="md">
          <div class="flex flex-col gap-1">
            <h2 class="text-title-sm">{m.apiTokens_createTitle()}</h2>
            <p class="text-body-sm text-muted-foreground">
              {m.apiTokens_createHint()}
            </p>
          </div>

          <form method="POST" action="?/create" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption uppercase tracking-wide text-muted-foreground"
                >{m.apiTokens_nameLabel()}</span
              >
              <input
                name="name"
                required
                maxlength="80"
                placeholder={m.apiTokens_namePlaceholder()}
                class="rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-caption uppercase tracking-wide text-muted-foreground">
                {m.apiTokens_expiryLabel()}
              </span>
              <select
                name="expiresInDays"
                class="rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {#each data.expiryPresets as days}
                  <option value={days} selected={days === 90}>
                    {days === 365
                      ? m.apiTokens_expiryOneYear()
                      : m.apiTokens_expiryDays({ days })}
                  </option>
                {/each}
              </select>
            </label>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-caption uppercase tracking-wide text-muted-foreground">
                {m.apiTokens_scopesLabel()}
              </legend>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each data.scopes as scope}
                  <label
                    class="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      checked={scope === "submissions:read" || scope === "submissions:write"}
                    />
                    <span class="text-body-sm">{scope}</span>
                  </label>
                {/each}
              </div>
            </fieldset>

            <button
              type="submit"
              class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <KeyRound aria-hidden="true" class="h-4 w-4" />
              {m.apiTokens_createButton()}
            </button>
          </form>
        </Card>
      </div>

      <div class="flex flex-col gap-4">
        {#if data.tokens.length === 0}
          <Card variant="surface" size="md">
            <h2 class="text-title-sm">{m.apiTokens_emptyTitle()}</h2>
            <p class="text-body-sm text-muted-foreground">
              {m.apiTokens_emptyHint()}
            </p>
          </Card>
        {:else}
          {#each data.tokens as token}
            <Card variant="surface" size="md">
              <div class="flex flex-col gap-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <h2 class="text-title-sm">{token.name}</h2>
                      <Badge
                        variant={token.status === "active" ? "success" : "muted"}
                        size="sm"
                      >
                        {token.status === "active"
                          ? m.apiTokens_status_active()
                          : m.apiTokens_status_revoked()}
                      </Badge>
                    </div>
                    <p class="text-body-sm text-muted-foreground">
                      {m.apiTokens_prefix({ prefix: token.prefix })}
                    </p>
                  </div>
                  <div class="text-right text-caption text-muted-foreground">
                    <p>{m.apiTokens_created({ date: formatDate(token.createdAt) })}</p>
                    <p>{m.apiTokens_expires({ date: formatDate(token.expiresAt) })}</p>
                  </div>
                </div>

                <dl class="grid gap-2 text-body-sm sm:grid-cols-2">
                  <div>
                    <dt class="text-caption uppercase tracking-wide text-muted-foreground">
                      {m.apiTokens_lastUsed()}
                    </dt>
                    <dd>{formatDate(token.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt class="text-caption uppercase tracking-wide text-muted-foreground">
                      {m.apiTokens_lastIp()}
                    </dt>
                    <dd>{token.lastUsedIp ?? "—"}</dd>
                  </div>
                </dl>

                <form method="POST" action="?/update" class="flex flex-col gap-3">
                  <input type="hidden" name="id" value={token.id} />
                  <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <label class="flex flex-col gap-1.5">
                      <span class="text-caption uppercase tracking-wide text-muted-foreground">
                        {m.apiTokens_nameLabel()}
                      </span>
                      <input
                        name="name"
                        required
                        maxlength="80"
                        value={token.name}
                        disabled={token.status !== "active"}
                        class="rounded-md border border-border bg-background px-3 py-2 text-body-sm disabled:opacity-60"
                      />
                    </label>
                    <label class="flex flex-col gap-1.5">
                      <span class="text-caption uppercase tracking-wide text-muted-foreground">
                        {m.apiTokens_extendBy()}
                      </span>
                      <select
                        name="expiresInDays"
                        disabled={token.status !== "active"}
                        class="rounded-md border border-border bg-background px-3 py-2 text-body-sm disabled:opacity-60"
                      >
                        {#each data.expiryPresets as days}
                          <option value={days} selected={days === 90}>
                            {days === 365
                              ? m.apiTokens_expiryOneYear()
                              : m.apiTokens_expiryDays({ days })}
                          </option>
                        {/each}
                      </select>
                    </label>
                  </div>

                  <fieldset class="flex flex-col gap-2" disabled={token.status !== "active"}>
                    <legend class="text-caption uppercase tracking-wide text-muted-foreground">
                      {m.apiTokens_scopesLabel()}
                    </legend>
                    <div class="grid gap-2 sm:grid-cols-2">
                      {#each data.scopes as scope}
                        <label
                          class="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            name="scopes"
                            value={scope}
                            checked={token.scopes.includes(scope)}
                          />
                          <span class="text-body-sm">{scope}</span>
                        </label>
                      {/each}
                    </div>
                  </fieldset>

                  <button
                    type="submit"
                    disabled={token.status !== "active"}
                    class="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-body-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save aria-hidden="true" class="h-4 w-4" />
                    {m.apiTokens_saveChanges()}
                  </button>
                </form>

                <div class="flex flex-wrap gap-2">
                  <form method="POST" action="?/rotate">
                    <input type="hidden" name="id" value={token.id} />
                    <button
                      type="submit"
                      disabled={token.status !== "active"}
                      class="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-body-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCw aria-hidden="true" class="h-4 w-4" />
                      {m.apiTokens_rotate()}
                    </button>
                  </form>

                  <form method="POST" action="?/revoke">
                    <input type="hidden" name="id" value={token.id} />
                    <button
                      type="submit"
                      disabled={token.status !== "active"}
                      class="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-destructive/50 px-3 text-body-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShieldOff aria-hidden="true" class="h-4 w-4" />
                      {m.apiTokens_revoke()}
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          {/each}
        {/if}
      </div>
    </div>
  </Section>
</PageContainer>
