<script lang="ts">
	import { cn } from "$lib/css.js";

	interface Props {
		keys: string[] | string[][];
		size?: "sm" | "md";
		class?: string;
	}

	let { keys, size = "sm", class: className }: Props = $props();

	const isMac = $derived(
		typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform),
	);

	function displayKey(key: string): string {
		const lower = key.toLowerCase();
		if (lower === "ctrl") return isMac ? "\u2318" : "Ctrl";
		if (lower === "cmd" || lower === "meta") return "\u2318";
		if (lower === "alt") return isMac ? "\u2325" : "Alt";
		if (lower === "shift") return "\u21e7";
		if (lower === "enter" || lower === "return") return "\u21b5";
		if (lower === "escape" || lower === "esc") return "esc";
		if (lower === "arrowup" || lower === "up") return "\u2191";
		if (lower === "arrowdown" || lower === "down") return "\u2193";
		if (lower === "arrowleft" || lower === "left") return "\u2190";
		if (lower === "arrowright" || lower === "right") return "\u2192";
		if (lower === "space") return "Space";
		return key;
	}

	const groups = $derived<string[][]>(
		Array.isArray(keys[0]) ? (keys as string[][]) : [keys as string[]],
	);

	const isSequence = $derived(groups.length > 1);

	const kbdClass = $derived(
		size === "md"
			? "inline-flex items-center justify-center min-w-[1.75rem] px-2 h-6 rounded-sm border border-border-strong bg-muted font-mono text-[length:var(--text-body-sm)] tabular-nums shadow-[0_1px_0_rgba(79,52,35,0.08)]"
			: "inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 rounded-sm border border-border-strong bg-muted font-mono text-[length:var(--text-caption)] tabular-nums shadow-[0_1px_0_rgba(79,52,35,0.08)]",
	);
</script>

<span class={cn("inline-flex items-center gap-1.5", className)}>
	{#each groups as group, groupIndex (groupIndex)}
		<span class="inline-flex items-center gap-1">
			{#each group as key, keyIndex (keyIndex)}
				{#if keyIndex > 0}
					<span class="text-muted-foreground" aria-hidden="true">+</span>
				{/if}
				<kbd class={kbdClass}>{displayKey(key)}</kbd>
			{/each}
		</span>
		{#if isSequence && groupIndex < groups.length - 1}
			<span class="text-muted-foreground text-[length:var(--text-caption)]">then</span>
		{/if}
	{/each}
</span>
