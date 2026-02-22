<script lang="ts">
	let {
		role,
		content
	}: {
		role: 'user' | 'assistant';
		content: string;
	} = $props();
</script>

{#if role === 'user'}
	<div class="flex justify-end px-4 py-1">
		<div
			class="max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-sm text-white"
		>
			<p class="whitespace-pre-wrap break-words">{content}</p>
		</div>
	</div>
{:else}
	<div class="flex justify-start px-4 py-1">
		<div class="max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-800 px-4 py-2.5 text-sm text-slate-100">
			<p class="whitespace-pre-wrap break-words">{content}</p>
		</div>
	</div>
{/if}
