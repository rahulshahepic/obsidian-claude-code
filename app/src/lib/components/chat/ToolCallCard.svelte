<script lang="ts">
	let {
		tool,
		input,
		output = undefined
	}: {
		tool: string;
		input: Record<string, unknown>;
		output?: string;
	} = $props();

	let collapsed = $state(true);

	const running = $derived(output === undefined);

	// Render a short single-line preview of the input
	const inputPreview = $derived.by(() => {
		// For Bash tool, show the command
		if (input.command && typeof input.command === 'string') {
			return input.command.split('\n')[0].slice(0, 60);
		}
		// For file tools, show the path
		if (input.path && typeof input.path === 'string') return input.path;
		if (input.file_path && typeof input.file_path === 'string') return input.file_path;
		// Generic fallback
		const keys = Object.keys(input);
		if (keys.length === 0) return '';
		const first = input[keys[0]];
		return typeof first === 'string' ? first.slice(0, 60) : '';
	});

	// Format input as pretty JSON
	const inputJson = $derived(JSON.stringify(input, null, 2));

	// Map tool names to icons
	const toolIcon = $derived.by(() => {
		const name = tool.toLowerCase();
		if (name.includes('bash') || name.includes('shell')) return '>';
		if (name.includes('read') || name.includes('view')) return 'R';
		if (name.includes('write') || name.includes('create') || name.includes('edit')) return 'W';
		if (name.includes('search') || name.includes('grep') || name.includes('find')) return 'S';
		if (name.includes('web') || name.includes('fetch')) return 'F';
		return 'T';
	});
</script>

<div class="mx-4 my-1">
	<div class="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
		<!-- Header -->
		<button
			class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
			onclick={() => (collapsed = !collapsed)}
		>
			<span
				class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 font-mono text-xs
                       {running ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}"
			>
				{toolIcon}
			</span>
			<span class="flex-1 truncate font-mono text-xs text-slate-300">{tool}</span>
			{#if inputPreview}
				<span class="truncate font-mono text-xs text-slate-500 max-w-[40%]">{inputPreview}</span>
			{/if}
			{#if running}
				<span class="shrink-0 text-xs text-amber-400">running</span>
			{:else}
				<span class="shrink-0 text-xs text-slate-600">{collapsed ? '▸' : '▾'}</span>
			{/if}
		</button>

		<!-- Expanded body -->
		{#if !collapsed}
			<div class="border-t border-slate-700">
				<!-- Input params -->
				<div class="px-3 py-2">
					<p class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Input</p>
					<pre class="overflow-x-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-300 whitespace-pre-wrap break-all">{inputJson}</pre>
				</div>

				<!-- Output -->
				{#if output !== undefined}
					<div class="border-t border-slate-700 px-3 py-2">
						<p class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Output</p>
						<pre class="overflow-x-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{output || '(empty)'}</pre>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
