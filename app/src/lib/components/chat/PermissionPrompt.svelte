<script lang="ts">
	let {
		id,
		tool,
		input,
		description,
		onRespond
	}: {
		id: string;
		tool: string;
		input: Record<string, unknown>;
		description: string;
		onRespond: (id: string, allow: boolean) => void;
	} = $props();

	// Show a short preview of what the tool will do
	const commandPreview = $derived(() => {
		if (input.command && typeof input.command === 'string') return input.command;
		if (input.path && typeof input.path === 'string') return input.path;
		if (input.file_path && typeof input.file_path === 'string') return input.file_path;
		return JSON.stringify(input, null, 2);
	})();
</script>

<!-- Backdrop -->
<div class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" aria-hidden="true"></div>

<!-- Bottom sheet -->
<div
	class="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-slate-900 px-5 pb-safe pt-6 shadow-2xl"
	style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.5rem)"
	role="dialog"
	aria-modal="true"
	aria-label="Permission request"
>
	<!-- Drag handle -->
	<div class="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-700"></div>

	<!-- Icon + title -->
	<div class="mb-4 flex items-start gap-3">
		<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
			<span class="text-xl">⚠</span>
		</div>
		<div>
			<h2 class="text-base font-semibold text-slate-100">Permission Required</h2>
			<p class="text-sm text-slate-400">{tool}</p>
		</div>
	</div>

	<!-- Description -->
	<p class="mb-3 text-sm text-slate-300">{description}</p>

	<!-- Command preview -->
	<div class="mb-5 rounded-xl bg-slate-950 px-3 py-2.5">
		<pre class="overflow-x-auto font-mono text-xs text-slate-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{commandPreview}</pre>
	</div>

	<!-- Action buttons -->
	<div class="flex gap-3">
		<button
			class="flex-1 rounded-2xl border border-slate-700 bg-slate-800 py-3.5 text-sm font-semibold text-slate-300
                   transition active:scale-95"
			onclick={() => onRespond(id, false)}
		>
			Deny
		</button>
		<button
			class="flex-1 rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white
                   transition active:scale-95"
			onclick={() => onRespond(id, true)}
		>
			Allow
		</button>
	</div>
</div>
