<script lang="ts">
	import { goto } from '$app/navigation';

	type Step = 'claude' | 'vault' | 'done';
	let step = $state<Step>('claude');
	let busy = $state(false);
	let error = $state('');

	// Claude auth step
	let claudeToken = $state('');
	async function saveClaudeToken() {
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/setup/claude/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: claudeToken.trim() })
			});
			if (!res.ok) throw new Error(await res.text());
			step = 'vault';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save token';
		} finally {
			busy = false;
		}
	}

	// Vault step
	let vaultPath = $state('');
	let vaultGitUrl = $state('');
	async function saveVault() {
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/setup/vault', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vaultPath: vaultPath.trim() })
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			vaultGitUrl = data.gitUrl;
			step = 'done';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save vault config';
		} finally {
			busy = false;
		}
	}

	const progressSteps: Step[] = ['claude', 'vault'];
	function progressIndex(s: Step) {
		return progressSteps.indexOf(s);
	}
</script>

<svelte:head>
	<title>Setup — Claude Code</title>
</svelte:head>

<div class="min-h-screen bg-slate-950 px-6 py-12 flex flex-col">
	<!-- Progress dots -->
	{#if step !== 'done'}
		<div class="mb-10 flex justify-center gap-2">
			{#each progressSteps as s}
				<div
					class="h-2 w-2 rounded-full transition-colors
                           {progressIndex(step) > progressIndex(s)
						? 'bg-violet-400'
						: step === s
							? 'bg-violet-600'
							: 'bg-slate-700'}"
				></div>
			{/each}
		</div>
	{/if}

	<div class="w-full max-w-sm mx-auto flex-1">
		<!-- Step 1: Claude token -->
		{#if step === 'claude'}
			<div class="mb-8 text-center">
				<div class="mb-4 text-5xl">🤖</div>
				<h1 class="text-2xl font-bold text-slate-100">Link Claude account</h1>
				<p class="mt-2 text-sm text-slate-400">
					Run this on a machine where you're logged into Claude Code, then paste the result:
				</p>
				<code
					class="mt-3 block rounded-xl bg-slate-900 px-4 py-3 text-left text-sm text-violet-300 font-mono"
				>
					claude setup-token
				</code>
			</div>
			<textarea
				bind:value={claudeToken}
				placeholder="sk-ant-oat01-…"
				rows={3}
				class="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-mono text-slate-200
                       placeholder:text-slate-600 border border-slate-800 focus:border-violet-500
                       focus:outline-none resize-none"
			></textarea>
			<button
				onclick={saveClaudeToken}
				disabled={busy || !claudeToken.trim()}
				class="mt-3 w-full rounded-2xl bg-violet-600 px-6 py-4 text-base font-semibold text-white
                       transition active:scale-95 disabled:opacity-50"
			>
				{busy ? 'Saving…' : 'Continue'}
			</button>

		<!-- Step 2: Vault path -->
		{:else if step === 'vault'}
			<div class="mb-8 text-center">
				<div class="mb-4 text-5xl">📁</div>
				<h1 class="text-2xl font-bold text-slate-100">Configure vault</h1>
				<p class="mt-2 text-sm text-slate-400">
					Where should the Obsidian vault live on this server?
				</p>
			</div>
			<label class="block">
				<span class="text-xs font-medium text-slate-400">Vault path on server</span>
				<input
					bind:value={vaultPath}
					type="text"
					placeholder="/var/vault"
					class="mt-1 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-mono text-slate-200
                           placeholder:text-slate-600 border border-slate-800 focus:border-violet-500
                           focus:outline-none"
				/>
			</label>
			<button
				onclick={saveVault}
				disabled={busy || !vaultPath.trim()}
				class="mt-4 w-full rounded-2xl bg-violet-600 px-6 py-4 text-base font-semibold text-white
                       transition active:scale-95 disabled:opacity-50"
			>
				{busy ? 'Saving…' : 'Finish Setup'}
			</button>

		<!-- Done -->
		{:else if step === 'done'}
			<div class="text-center">
				<div class="mb-4 text-5xl">✅</div>
				<h1 class="mb-3 text-2xl font-bold text-slate-100">You're all set!</h1>
				{#if vaultGitUrl}
					<p class="mb-2 text-sm text-slate-400">
						Point the Obsidian Git plugin to this remote:
					</p>
					<code class="block rounded-xl bg-slate-900 px-4 py-3 text-sm text-violet-300 font-mono break-all">
						{vaultGitUrl}
					</code>
				{/if}
				<button
					onclick={() => goto('/')}
					class="mt-6 w-full rounded-2xl bg-violet-600 px-6 py-4 text-base font-semibold text-white"
				>
					Open Claude Code →
				</button>
			</div>
		{/if}

		{#if error}
			<p class="mt-4 rounded-xl bg-rose-950 px-4 py-3 text-sm text-rose-300">{error}</p>
		{/if}
	</div>
</div>
