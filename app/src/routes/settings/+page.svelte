<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Re-auth section
	let showReauth = $state(false);
	type AuthMode = 'browser' | 'token';
	let authMode = $state<AuthMode>('browser');
	let saving = $state(false);
	let saveError = $state('');

	// Browser OAuth flow
	let authUrl = $state('');
	let authCode = $state('');
	let authUrlLoading = $state(false);

	async function startBrowserAuth() {
		authUrlLoading = true;
		saveError = '';
		try {
			const res = await fetch('/api/setup/claude/start');
			if (!res.ok) throw new Error(await res.text());
			const d = await res.json();
			authUrl = d.url;
			window.open(authUrl, '_blank');
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to start auth';
		} finally {
			authUrlLoading = false;
		}
	}

	async function exchangeAuthCode() {
		saving = true;
		saveError = '';
		try {
			const res = await fetch('/api/setup/claude/exchange', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: authCode.trim() })
			});
			if (!res.ok) throw new Error(await res.text());
			authCode = '';
			authUrl = '';
			showReauth = false;
			location.reload();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to exchange code';
		} finally {
			saving = false;
		}
	}

	// Token paste fallback
	let newToken = $state('');

	async function updateToken() {
		saving = true;
		saveError = '';
		try {
			const res = await fetch('/api/settings/claude/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: newToken.trim() })
			});
			if (!res.ok) throw new Error(await res.text());
			newToken = '';
			showReauth = false;
			location.reload();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update token';
		} finally {
			saving = false;
		}
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
				onclick={() => { showReauth = !showReauth; saveError = ''; authUrl = ''; }}
				class="mt-3 text-sm text-violet-400 active:text-violet-200"
			>
				{showReauth ? 'Cancel' : 'Update token →'}
			</button>

			{#if showReauth}
				<div class="mt-3 border-t border-slate-800 pt-3">
					<!-- Mode tabs -->
					<div class="mb-4 flex rounded-xl bg-slate-950 p-1">
						<button
							onclick={() => { authMode = 'browser'; saveError = ''; }}
							class="flex-1 rounded-lg py-2 text-xs font-medium transition
							       {authMode === 'browser'
								? 'bg-slate-700 text-slate-100'
								: 'text-slate-500'}"
						>
							Sign in with Claude
						</button>
						<button
							onclick={() => { authMode = 'token'; saveError = ''; }}
							class="flex-1 rounded-lg py-2 text-xs font-medium transition
							       {authMode === 'token'
								? 'bg-slate-700 text-slate-100'
								: 'text-slate-500'}"
						>
							Paste token
						</button>
					</div>

					{#if authMode === 'browser'}
						<!-- Browser OAuth flow -->
						{#if !authUrl}
							<p class="mb-3 text-sm text-slate-400">
								Opens the Claude authorization page. After signing in, copy the code and paste it here.
							</p>
							<button
								onclick={startBrowserAuth}
								disabled={authUrlLoading}
								class="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white
								       transition active:scale-95 disabled:opacity-50"
							>
								{authUrlLoading ? 'Opening…' : 'Sign in with Claude →'}
							</button>
						{:else}
							<p class="mb-2 text-sm text-slate-400">
								Complete sign-in on the Anthropic page, then paste the authorization code here.
							</p>
							<button
								onclick={startBrowserAuth}
								disabled={authUrlLoading}
								class="mb-3 text-xs text-violet-400 underline"
							>
								Open the page again
							</button>
							<input
								bind:value={authCode}
								type="text"
								placeholder="Paste code from Anthropic…"
								class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2
								       font-mono text-sm text-slate-200 placeholder:text-slate-600
								       focus:border-violet-500 focus:outline-none"
							/>
							<button
								onclick={exchangeAuthCode}
								disabled={saving || !authCode.trim()}
								class="mt-2 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white
								       transition active:scale-95 disabled:opacity-50"
							>
								{saving ? 'Verifying…' : 'Save'}
							</button>
						{/if}
					{:else}
						<!-- Token paste fallback -->
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
					{/if}

					{#if saveError}
						<p class="mt-2 rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-300">
							{saveError}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</section>

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
