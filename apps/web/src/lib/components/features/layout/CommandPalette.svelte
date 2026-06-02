<script lang="ts">
  import SearchIcon from "@lucide/svelte/icons/search";
  import CornerDownLeftIcon from "@lucide/svelte/icons/corner-down-left";
  import * as Dialog from "$lib/components/primitives/ui/dialog/index.js";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { shortcuts } from "$lib/stores/shortcuts.svelte";
  import { submissionFeedback } from "$lib/stores/submission-feedback.svelte";

  interface Command {
    id: string;
    label: string;
    run: () => void;
  }

  let open = $state(false);
  let query = $state("");
  let highlighted = $state(0);

  function close() {
    open = false;
    query = "";
    highlighted = 0;
  }

  function navigate(href: string) {
    close();
    void goto(href);
  }

  const commands: Command[] = $derived([
    { id: "nav-dashboard", label: m.shortcuts_goDashboard(), run: () => navigate("/dashboard") },
    { id: "nav-problems", label: m.shortcuts_goProblems(), run: () => navigate("/problems") },
    { id: "nav-exams", label: m.shortcuts_goExams(), run: () => navigate("/exams") },
    { id: "nav-contests", label: m.shortcuts_goContests(), run: () => navigate("/contests") },
    {
      id: "nav-submissions",
      label: m.shortcuts_goSubmissions(),
      run: () => navigate("/submissions")
    },
    { id: "nav-account", label: m.commandPalette_goAccount(), run: () => navigate("/account") },
    {
      id: "act-shortcuts",
      label: m.commandPalette_showShortcuts(),
      run: () => {
        close();
        shortcuts.isOverlayOpen = true;
      }
    },
    {
      id: "act-sound",
      label: submissionFeedback.enabled
        ? m.commandPalette_soundOff()
        : m.commandPalette_soundOn(),
      run: () => {
        submissionFeedback.toggle();
        close();
      }
    }
  ]);

  let trimmed = $derived(query.trim());
  let needle = $derived(trimmed.toLowerCase());
  let filtered = $derived(
    needle === "" ? commands : commands.filter((c) => c.label.toLowerCase().includes(needle))
  );

  function searchProblems() {
    navigate(trimmed ? `/problems?q=${encodeURIComponent(trimmed)}` : "/problems");
  }

  let entries = $derived([
    ...filtered.map((c) => ({ key: c.id, label: c.label, run: c.run })),
    ...(trimmed
      ? [
          {
            key: "search-problems",
            label: m.commandPalette_searchProblems({ query: trimmed }),
            run: searchProblems
          }
        ]
      : [])
  ]);

  $effect(() => {
    void entries.length;
    if (highlighted >= entries.length) highlighted = Math.max(0, entries.length - 1);
  });

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlighted = entries.length === 0 ? 0 : (highlighted + 1) % entries.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = entries.length === 0 ? 0 : (highlighted - 1 + entries.length) % entries.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      entries[highlighted]?.run();
    }
  }

  $effect(() => {
    submissionFeedback.hydrate();
  });

  $effect(() =>
    shortcuts.register({
      id: "command-palette",
      keys: ["Ctrl", "K"],
      description: m.commandPalette_open(),
      category: "actions",
      allowInInputs: true,
      handler: () => {
        open = true;
      }
    })
  );
</script>

<Dialog.Root bind:open onOpenChange={(next) => !next && close()}>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-[var(--z-modal)] bg-black/50 backdrop-blur-sm motion-safe:animate-[fade-in_160ms_var(--ease-out-soft)_both]"
    />
    <Dialog.Content
      class="fixed left-1/2 top-[12vh] z-[var(--z-modal)] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-modal motion-safe:animate-[fade-up_200ms_var(--ease-out-soft)_both]"
    >
      <Dialog.Title class="sr-only">{m.commandPalette_open()}</Dialog.Title>
      <Dialog.Description class="sr-only">{m.commandPalette_placeholder()}</Dialog.Description>

      <div class="flex items-center gap-2 border-b border-border-subtle px-4">
        <SearchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={query}
          onkeydown={onInputKeydown}
          placeholder={m.commandPalette_placeholder()}
          aria-label={m.commandPalette_placeholder()}
          class="h-12 w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
        />
      </div>

      {#if entries.length === 0}
        <p class="px-4 py-6 text-center text-body-sm text-muted-foreground">
          {m.commandPalette_empty()}
        </p>
      {:else}
        <ul class="max-h-[50vh] overflow-y-auto p-2">
          {#each entries as entry, index (entry.key)}
            <li>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-body-sm transition-colors duration-fast ease-out-soft {index ===
                highlighted
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent/60'}"
                onclick={entry.run}
                onmouseenter={() => (highlighted = index)}
              >
                <span class="truncate">{entry.label}</span>
                {#if index === highlighted}
                  <CornerDownLeftIcon class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
