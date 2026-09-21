<script lang="ts">
  import { goto } from "$app/navigation";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import { Button, buttonVariants } from "$lib/components/primitives/ui/button";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { Input } from "$lib/components/primitives/ui/input";
  import { fetchWithCsrf } from "$lib/services/http";
  import { m } from "$lib/paraglide/messages.js";

  let open = $state(false);
  let username = $state("");
  let password = $state("");
  let usernameInput = $state<HTMLInputElement | null>(null);
  let loading = $state(false);
  let error = $state("");

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (loading) return;
    loading = true;
    error = "";
    try {
      const response = await fetchWithCsrf("/api/auth/sign-in/exam-password", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = (await response.json()) as { examId?: string };
      if (!response.ok || !result.examId) {
        error =
          response.status === 429
            ? m.auth_examPasswordRateLimited()
            : response.status >= 500
              ? m.auth_examPasswordUnavailable()
              : m.auth_examPasswordInvalid();
        return;
      }
      password = "";
      await goto(`/exams/${encodeURIComponent(result.examId)}`, { invalidateAll: true });
      open = false;
    } catch {
      error = m.auth_examPasswordUnavailable();
    } finally {
      loading = false;
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (loading) return;
    open = next;
    if (!next) {
      password = "";
      error = "";
    }
  }}
>
  <Dialog.Trigger
    class={buttonVariants({ variant: "outline", size: "lg", class: "w-full" })}
    disabled={loading}
  >
    <KeyRound aria-hidden="true" />
    {m.auth_continueWithPassword()}
  </Dialog.Trigger>
  <Dialog.Content
    class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md sm:p-8"
    showCloseButton={!loading}
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      usernameInput?.focus();
    }}
  >
    <Dialog.Header class="text-center sm:text-center">
      <Dialog.Title class="text-title-lg leading-tight"
        >{m.auth_continueWithPassword()}</Dialog.Title
      >
      <Dialog.Description>{m.auth_examPasswordHint()}</Dialog.Description>
    </Dialog.Header>
    {#if error}
      <div
        role="alert"
        class="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
      >
        {error}
      </div>
    {/if}
    <form id="exam-password-form" class="flex flex-col gap-4" onsubmit={signIn}>
      <FormField label={m.examCredentials_username()} for="exam-login-username" required>
        <Input
          bind:ref={usernameInput}
          id="exam-login-username"
          name="username"
          autocomplete="username"
          bind:value={username}
          required
          disabled={loading}
        />
      </FormField>
      <FormField label={m.examCredentials_password()} for="exam-login-password" required>
        <Input
          id="exam-login-password"
          name="password"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
          disabled={loading}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        class="w-full"
        {loading}
        disabled={!username.trim() || !password}
        >{loading ? m.auth_signingIn() : m.auth_examPasswordSignIn()}</Button
      >
    </form>
    <Dialog.Close
      disabled={loading}
      class="text-center text-body-sm text-muted-foreground underline-offset-4 hover:underline"
      >{m.auth_backToOAuthSignIn()}</Dialog.Close
    >
  </Dialog.Content>
</Dialog.Root>
