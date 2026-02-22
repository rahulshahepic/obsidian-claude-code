<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Re-auth section
	let showReauth = $state(false);
	let newToken = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let saveSuccess = $state(false);

	async function updateToken() {
		saving = true;
		saveError = '';
		saveSuccess = false;
		try {
			const res = await fetch('/api/settings/claude/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: newToken.trim() })
			});
			if (!res.ok) throw new Error(await res.text());
			saveSuccess = true;
			newToken = '';
			showReauth = false;
			// Reload to get fresh token status from server
			location.reload();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update token';
		} finally {
			saving = false;
		}
	}

	// Copy vault Git URL to clipboard
	let copied = $state(false);
	async function copyGitUrl() {
		if (!data.vaultGitUrl) return;
		await navigator.clipboard.writeText(data.vaultGitUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function fmtExpiry(s?: number) {
		if (s === undefined) return '—';
		if (s <= 0) return 'Expired';
		const h = Math.floor(s / 3600);
		const d = Math.floor(h / 24);
		if (d > 0) return `${d}d ${h % 24}h`;
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
</script>

<svelte:head>
	<title>Settings — Claude Code</title>
</svelte:head>

<div
	class="min-h-screen bg-slate-950 px-4 py-6"
	style="padding-bottom: env(safe-area-inset-bottom, 4rem)"
>
	<h1 class="mb-6 text-lg font-semibold text-slate-100">Settings</h1>

	<!-- Claude Auth -->
	<section class="mb-4">
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Claude Auth</h2>
		<div class="rounded-xl bg-slate-900 px-4 py-4">
			<div class="flex items-center justify-between">
				<span class="text-slate-300">Token</span>
				<span
					class="font-medium {data.tokenStatus.valid ? 'text-emerald-400' : 'text-rose-400'}"
				>
					{data.tokenStatus.valid ? 'Valid' : 'Expired'}
				</span>
			</div>
			<p class="mt-1 text-sm text-slate-500">
				{#if data.tokenStatus.valid}
					Expires in {fmtExpiry(data.tokenStatus.expiresInSeconds)}
				{:else}
					Token has expired — re-authenticate to continue
				{/if}
			</p>
			{#if data.tokenRefreshedAt}
				<p class="mt-0.5 text-xs text-slate-600">
					Last updated {new Date(data.tokenRefreshedAt).toLocaleString()}
				</p>
			{/if}

			<button
				onclick={() => (showReauth = !showReauth)}
				class="mt-3 text-sm text-violet-400 active:text-violet-200"
			>
				{showReauth ? 'Cancel' : 'Update token →'}
			</button>

			{#if showReauth}
				<div class="mt-3 border-t border-slate-800 pt-3">
					<p class="mb-2 text-sm text-slate-400">
						Run this on a machine where you're logged into Claude Code:
					</p>
					<code
						class="mb-3 block rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm text-violet-300"
					>
						claude setup-token
					</code>
					<textarea
						bind:value={newToken}
						placeholder="sk-ant-oat01-…"
						rows={3}
						class="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2
                               font-mono text-sm text-slate-200 placeholder:text-slate-600
                               focus:border-violet-500 focus:outline-none"
					></textarea>
					<button
						onclick={updateToken}
						disabled={saving || !newToken.trim()}
						class="mt-2 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white
                               transition active:scale-95 disabled:opacity-50"
					>
						{saving ? 'Saving…' : 'Save token'}
					</button>
					{#if saveError}
						<p class="mt-2 rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-300">
							{saveError}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</section>

	<!-- Vault -->
	{#if data.vaultPath}
		<section class="mb-4">
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Vault</h2>
			<div class="rounded-xl bg-slate-900 px-4 py-4">
				<p class="mb-1 text-sm text-slate-400">Server path</p>
				<p class="break-all font-mono text-sm text-slate-300">{data.vaultPath}</p>
				{#if data.vaultGitUrl}
					<p class="mb-1 mt-3 text-sm text-slate-400">Obsidian Git remote</p>
					<div class="flex items-center gap-2">
						<code
							class="min-w-0 flex-1 break-all rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm text-violet-300"
						>
							{data.vaultGitUrl}
						</code>
						<button
							onclick={copyGitUrl}
							class="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300
                                   active:bg-slate-700"
						>
							{copied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<!-- App info -->
	<section>
		<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">App</h2>
		<div class="rounded-xl bg-slate-900 px-4 py-4">
			<div class="flex items-center justify-between">
				<span class="text-sm text-slate-400">Version</span>
				<span class="font-mono text-sm text-slate-300">0.1.0</span>
			</div>
		</div>
	</section>
</div>
