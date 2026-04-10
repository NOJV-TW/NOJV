<script lang="ts">
	import type { Component } from "svelte";
	import { Check, ExternalLink } from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils.js";

	type ActionVariant = "default" | "outline" | "ghost";

	interface EmptyStateAction {
		href: string;
		label: string;
		variant?: ActionVariant;
	}

	interface Props {
		icon: Component<{ class?: string }>;
		title: string;
		description?: string;
		actionHref?: string;
		actionLabel?: string;
		variant?: "minimal" | "onboarding";
		actions?: EmptyStateAction[];
		tips?: string[];
		docsHref?: string;
		docsLabel?: string;
		class?: string;
	}

	let {
		icon: Icon,
		title,
		description,
		actionHref,
		actionLabel,
		variant = "minimal",
		actions,
		tips,
		docsHref,
		docsLabel,
		class: className,
	}: Props = $props();

	const isOnboarding = $derived(variant === "onboarding");
</script>

{#if isOnboarding}
	<div
		class={cn("flex flex-col items-center justify-center py-12 text-center", className)}
	>
		<div
			class="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10"
		>
			<Icon class="h-8 w-8 text-primary" />
		</div>
		<h3
			class="font-display text-[length:var(--text-title-lg)] leading-tight mt-5 [text-wrap:balance]"
		>
			{title}
		</h3>
		{#if description}
			<p
				class="mt-2 max-w-lg text-[length:var(--text-body)] text-muted-foreground [text-wrap:pretty]"
			>
				{description}
			</p>
		{/if}
		{#if actions && actions.length > 0}
			<div class="flex flex-wrap items-center justify-center gap-3 mt-6">
				{#each actions as action (action.href + action.label)}
					<Button href={action.href} variant={action.variant ?? "default"}>
						{action.label}
					</Button>
				{/each}
			</div>
		{/if}
		{#if tips && tips.length > 0}
			<ul
				class="mt-6 flex flex-col gap-2 text-left text-[length:var(--text-body-sm)] text-muted-foreground max-w-md"
			>
				{#each tips as tip (tip)}
					<li class="flex items-start gap-2">
						<Check class="size-4 mt-0.5 shrink-0 text-success" aria-hidden="true" />
						<span>{tip}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if docsHref && docsLabel}
			<a
				href={docsHref}
				class="mt-6 inline-flex items-center gap-1.5 text-[length:var(--text-body-sm)] text-muted-foreground hover:text-foreground transition-colors duration-fast ease-out-soft"
			>
				{docsLabel}
				<ExternalLink class="size-3.5" aria-hidden="true" />
			</a>
		{/if}
	</div>
{:else}
	<div
		class={cn("flex flex-col items-center justify-center py-16 text-center", className)}
	>
		<div
			class="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/60"
		>
			<Icon class="h-7 w-7 text-muted-foreground/70" />
		</div>
		<h3
			class="font-display text-[length:var(--text-title)] leading-tight mt-4 [text-wrap:balance]"
		>
			{title}
		</h3>
		{#if description}
			<p
				class="mt-1 max-w-sm text-[length:var(--text-body-sm)] text-muted-foreground [text-wrap:pretty]"
			>
				{description}
			</p>
		{/if}
		{#if actionHref && actionLabel}
			<div class="mt-5">
				<Button href={actionHref}>{actionLabel}</Button>
			</div>
		{/if}
	</div>
{/if}
