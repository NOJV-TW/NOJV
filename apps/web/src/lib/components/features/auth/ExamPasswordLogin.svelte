<script lang="ts">
  import { goto } from "$app/navigation";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Input } from "$lib/components/primitives/ui/input";
  import { fetchWithCsrf } from "$lib/services/http";
  import { m } from "$lib/paraglide/messages.js";

  let expanded = $state(false);
  let username = $state("");
  let password = $state("");
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
    } catch {
      error = m.auth_examPasswordUnavailable();
    } finally {
      loading = false;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <Button
    variant="outline"
    size="lg"
    aria-expanded={expanded}
    aria-controls="exam-password-form"
    disabled={loading}
    onclick={() => (expanded = !expanded)}
  >
    <KeyRound aria-hidden="true" />
    {m.auth_continueWithPassword()}
  </Button>
  {#if expanded}
    <form id="exam-password-form" class="space-y-4 pt-1" onsubmit={signIn}>
      <p class="text-body-sm text-muted-foreground">{m.auth_examPasswordHint()}</p>
      <div class="space-y-1.5">
        <label for="exam-login-username" class="text-body-sm font-medium"
          >{m.examCredentials_username()}</label
        >
        <Input
          id="exam-login-username"
          name="username"
          autocomplete="username"
          bind:value={username}
          required
          disabled={loading}
        />
      </div>
      <div class="space-y-1.5">
        <label for="exam-login-password" class="text-body-sm font-medium"
          >{m.examCredentials_password()}</label
        >
        <Input
          id="exam-login-password"
          name="password"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
          disabled={loading}
        />
      </div>
      {#if error}<p role="alert" class="text-body-sm text-destructive">{error}</p>{/if}
      <Button type="submit" class="w-full" {loading} disabled={!username.trim() || !password}
        >{m.auth_examPasswordSignIn()}</Button
      >
    </form>
  {/if}
</div>
