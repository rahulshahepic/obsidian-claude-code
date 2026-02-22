import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['src/test-setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/server/**/*.ts'],
			exclude: ['src/lib/server/db/schema.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80
			},
			reporter: ['text', 'html']
		}
	}
});
