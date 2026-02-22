/**
 * Git smart HTTP backend for the vault repository.
 *
 * Serves the vault at `/vault.git` so Obsidian Git can push and pull over
 * HTTP.  All requests are delegated to `git http-backend` (the standard CGI
 * program that ships with git).
 *
 * Auth: HTTP Basic.  If GIT_HTTP_PASSWORD is set in the environment, every
 * request must supply that password (any username works).  If the variable is
 * unset, the endpoint is open — useful during local development.
 *
 * Route: /vault.git/[...path]
 *   GET  /vault.git/info/refs?service=git-{upload,receive}-pack
 *   POST /vault.git/git-upload-pack   (fetch / clone)
 *   POST /vault.git/git-receive-pack  (push)
 */
import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/db/index.js';
import { parseBasicAuth, parseGitBackendResponse } from '$lib/server/git.js';
import { spawn } from 'child_process';
import path from 'path';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function checkAuth(request: Request): boolean {
	const password = process.env.GIT_HTTP_PASSWORD;
	if (!password) return true; // No password configured — dev mode, open access
	const creds = parseBasicAuth(request.headers.get('Authorization'));
	return creds !== null && creds.password === password;
}

// ---------------------------------------------------------------------------
// git http-backend wrapper
// ---------------------------------------------------------------------------

function runGitBackend(
	input: Buffer | null,
	env: Record<string, string>
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
	return new Promise((resolve, reject) => {
		const proc = spawn('git', ['http-backend'], { env });

		const chunks: Buffer[] = [];
		proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
		proc.stdout.on('end', () => {
			const output = Buffer.concat(chunks);
			resolve(parseGitBackendResponse(output));
		});

		// Drain stderr to prevent the process from blocking
		proc.stderr.on('data', () => {});

		proc.on('error', reject);

		if (input && input.length > 0) {
			proc.stdin.write(input);
		}
		proc.stdin.end();
	});
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleGitRequest(request: Request, pathParam: string): Promise<Response> {
	if (!checkAuth(request)) {
		return new Response('Unauthorized', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Basic realm="vault"' }
		});
	}

	const vaultPath = getConfig('vault_path');
	if (!vaultPath) {
		return new Response('Vault not configured', { status: 503 });
	}

	const url = new URL(request.url);
	const queryString = url.search ? url.search.slice(1) : '';

	// git http-backend resolves the repo as:
	//   GIT_PROJECT_ROOT/<name>.git  →  GIT_PROJECT_ROOT/<name>  (non-bare)
	// We construct PATH_INFO using the actual vault directory basename so the
	// lookup works regardless of where the vault is stored on disk.
	const repoParent = path.dirname(vaultPath);
	const repoBasename = path.basename(vaultPath);
	const pathInfo = `/${repoBasename}.git/${pathParam}`;

	// Read the request body for POST requests
	const input =
		request.method === 'POST' ? Buffer.from(await request.arrayBuffer()) : null;

	const env: Record<string, string> = {
		// Inherit PATH so git can find its sub-commands
		PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
		GIT_HTTP_EXPORT_ALL: '1',
		GIT_PROJECT_ROOT: repoParent,
		PATH_INFO: pathInfo,
		QUERY_STRING: queryString,
		REQUEST_METHOD: request.method,
		CONTENT_TYPE: request.headers.get('Content-Type') ?? '',
		CONTENT_LENGTH: input ? String(input.length) : '0'
	};

	let result: { status: number; headers: Record<string, string>; body: Buffer };
	try {
		result = await runGitBackend(input, env);
	} catch (err) {
		console.error('[git http-backend] spawn error:', err);
		return new Response('Git backend unavailable', { status: 502 });
	}

	return new Response(result.body, {
		status: result.status,
		headers: result.headers
	});
}

export const GET: RequestHandler = ({ request, params }) =>
	handleGitRequest(request, params.path ?? '');

export const POST: RequestHandler = ({ request, params }) =>
	handleGitRequest(request, params.path ?? '');
