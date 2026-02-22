<script lang="ts">
	let {
		file,
		patch
	}: {
		file: string;
		patch: string;
	} = $props();

	type DiffLine = {
		type: 'header' | 'hunk' | 'add' | 'remove' | 'context';
		content: string;
	};

	const lines = $derived<DiffLine[]>(() => {
		return patch.split('\n').map((line): DiffLine => {
			if (line.startsWith('+++') || line.startsWith('---')) return { type: 'header', content: line };
			if (line.startsWith('@@')) return { type: 'hunk', content: line };
			if (line.startsWith('+')) return { type: 'add', content: line };
			if (line.startsWith('-')) return { type: 'remove', content: line };
			return { type: 'context', content: line };
		});
	})();
</script>

<div class="mx-4 my-1 rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
	<!-- File name header -->
	<div class="flex items-center gap-2 border-b border-slate-700 px-3 py-2">
		<span class="text-xs text-slate-500">diff</span>
		<span class="flex-1 truncate font-mono text-xs text-slate-300">{file}</span>
	</div>

	<!-- Diff lines -->
	<div class="overflow-x-auto">
		{#each lines as line}
			<div
				class="px-3 py-0.5 font-mono text-xs leading-5
                       {line.type === 'add'
					? 'bg-emerald-950/50 text-emerald-300'
					: line.type === 'remove'
						? 'bg-rose-950/50 text-rose-300'
						: line.type === 'hunk'
							? 'bg-blue-950/50 text-blue-400'
							: line.type === 'header'
								? 'text-slate-500'
								: 'text-slate-400'}"
			>
				<pre class="whitespace-pre-wrap break-all">{line.content}</pre>
			</div>
		{/each}
	</div>
</div>
