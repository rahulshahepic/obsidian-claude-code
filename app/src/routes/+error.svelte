<script lang="ts">
	import { page } from '$app/stores';
</script>

<svelte:head>
	<title>Error {$page.status} — Claude Code</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6">
	<div class="w-full max-w-sm text-center">
		<p class="text-5xl font-bold text-slate-600">{$page.status}</p>
		<p class="mt-4 text-lg font-semibold text-slate-200">
			{$page.status === 500 ? 'Server error' : $page.error?.message ?? 'Something went wrong'}
		</p>
		{#if $page.status === 500 && $page.error?.message}
			<p class="mt-2 rounded-xl bg-slate-900 px-4 py-3 text-left font-mono text-xs text-rose-400">
				{$page.error.message}
			</p>
		{/if}
		<a href="/" class="mt-8 inline-block text-sm text-slate-400 underline hover:text-slate-200">
			Go home
		</a>
	</div>
</div>
