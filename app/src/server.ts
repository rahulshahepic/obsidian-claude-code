/**
 * Custom production server entry point for adapter-node.
 *
 * Instead of running `node build/index.js`, run `node build/server.js`.
 * This file is compiled by the build step alongside the SvelteKit app.
 *
 * It creates a Node HTTP server, attaches the WebSocket handler,
 * then hands all other requests to the SvelteKit handler.
 */
import { createServer } from 'http';
import { handler } from '../build/handler.js';
import { attachWebSocketServer } from './lib/server/ws-server.js';

// Validate required env vars at startup so missing config fails fast with a
// clear message in logs rather than a cryptic 500 on the first affected request.
const REQUIRED_ENV_VARS = [
	'APP_SECRET',
	'ENCRYPTION_KEY',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'ALLOWED_EMAIL',
	'PUBLIC_URL'
];

const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
if (missing.length > 0) {
	console.error('ERROR: Missing required environment variables:');
	missing.forEach((k) => console.error(`  - ${k}`));
	console.error('Check your .env file or GitHub Secrets configuration.');
	process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const httpServer = createServer(handler);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
	console.log(`Server running on http://0.0.0.0:${PORT}`);
});
