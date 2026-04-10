<script lang="ts">
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import KeyboardShortcut from "$lib/components/ui/KeyboardShortcut.svelte";
	import { shortcuts, type Shortcut, type ShortcutCategory } from "$lib/stores/shortcuts.svelte.js";
	import { m } from "$lib/paraglide/messages.js";

	const CATEGORY_ORDER: ShortcutCategory[] = ["navigation", "actions", "help"];

	const grouped = $derived.by(() => {
		const buckets = new Map<ShortcutCategory, Shortcut[]>();
		for (const category of CATEGORY_ORDER) {
			buckets.set(category, []);
		}
		for (const shortcut of shortcuts.shortcuts) {
			buckets.get(shortcut.category)?.push(shortcut);
		}
		return CATEGORY_ORDER.map((category) => ({
			category,
			entries: buckets.get(category) ?? [],
		})).filter((group) => group.entries.length > 0);
	});

	function categoryLabel(category: ShortcutCategory): string {
		if (category === "navigation") return m.shortcuts_category_navigation();
		if (category === "actions") return m.shortcuts_category_actions();
		return m.shortcuts_category_help();
	}
</script>

<Dialog.Root bind:open={shortcuts.isOverlayOpen}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[var(--z-modal)]"
		/>
		<Dialog.Content
			class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl border border-border bg-card shadow-modal p-6 z-[var(--z-modal)]"
		>
			<Dialog.Title class="font-display text-[length:var(--text-title-lg)] leading-tight">
				{m.shortcuts_overlayTitle()}
			</Dialog.Title>
			<Dialog.Description
				class="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground"
			>
				{m.shortcuts_overlayDescription()}
			</Dialog.Description>

			{#if grouped.length === 0}
				<p
					class="mt-6 text-[length:var(--text-body-sm)] text-muted-foreground"
				>
					{m.shortcuts_overlayDescription()}
				</p>
			{:else}
				{#each grouped as group (group.category)}
					<h4
						class="text-[length:var(--text-body-sm)] uppercase tracking-wide text-muted-foreground mt-4"
					>
						{categoryLabel(group.category)}
					</h4>
					<ul class="mt-2 flex flex-col gap-2">
						{#each group.entries as shortcut (shortcut.id)}
							<li
								class="flex items-center justify-between gap-4 text-[length:var(--text-body-sm)]"
							>
								<span class="text-foreground">{shortcut.description}</span>
								<KeyboardShortcut keys={shortcut.keys} />
							</li>
						{/each}
					</ul>
				{/each}
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
