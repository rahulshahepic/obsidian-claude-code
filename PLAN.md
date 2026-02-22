# Obsidian Claude Code — Architecture Plan (v2)

## What This Is

A self-hosted web app (PWA) that **one person deploys on their own VPS** to run Claude Code
sessions from their phone, with their Obsidian vault synced via Git. You chat with Claude Code
in a mobile browser, it reads/writes your vault, and the Obsidian app syncs changes via the
Obsidian Git plugin.

**Single-user, self-hosted.** You deploy it for yourself. No accounts, no multi-tenancy.

---

## Current Status — last updated 2026-02-22

### Done
| Area | What's built | Commit |
|---|---|---|
| App scaffold | SvelteKit + Tailwind v4 + adapter-node + PWA manifest + iOS meta tags | Phase 1 |
| Database | Drizzle ORM + SQLite, `config` + `sessions` schema, initial migration | Phase 1 |
| Encryption | AES-256-GCM (`crypto.ts`) for token storage at rest | Phase 1 |
| Auth | WebAuthn/Passkeys — registration + authentication ceremonies, HMAC-signed session cookie | Phase 1 |
| Route guards | `hooks.server.ts` — redirects to `/setup` if not configured, `/login` if not authed | Phase 1 |
| Setup wizard | `/setup` — passkey registration → Claude token paste → vault path config | Phase 1 |
| Login page | `/login` — WebAuthn authenticate, `return_to` redirect after success | Phase 1 |
| Monitoring | `monitor.ts` with exported pure parsers; `/api/health` (unauthenticated, 200/503); `/api/monitor`; `/monitor` page with auto-refresh | Phase 1 |
| Unit tests | 46 tests across 4 suites (crypto, session, monitor parsers, db); all passing | Phase 1 |
| CI | GitHub Actions — runs `vitest --coverage` on every PR; blocks merge if thresholds missed | Phase 1 |
| Claude OAuth module | `claude/oauth.ts`: PKCE helpers, `needsRefresh`, `refreshAccessToken`, `storeTokens`/`loadTokens` (encrypted) | Phase 2 |
| Token storage | Setup wizard + settings re-auth both use `storeTokens`; `claude_token_refreshed_at` now recorded | Phase 2 |
| Settings page | `/settings` — token status (valid/expired, expiry time, last updated), re-auth token paste, vault path + Git URL copy | Phase 2 |
| Settings API | `POST /api/settings/claude/token` — update token post-setup (auth-gated) | Phase 2 |
| Unit tests | 88 tests across 6 suites (adds oauth.ts: PKCE, needsRefresh, refreshAccessToken, storeTokens, loadTokens); all passing | Phase 2 |
| Workspace container | `container/Dockerfile` (ubuntu:24.04 + Node LTS + Claude CLI + uv); `docker-exec-wrapper.sh` | Phase 3 |
| Docker lifecycle | `docker.ts` — `getContainerState`, `ensureContainerRunning`, `stopContainer`; pure `parseInspectStatus` exported for tests | Phase 3 |
| WS protocol | `lib/ws-protocol.ts` — `WsServerMsg` / `WsClientMsg` union types + `isClientMsg` guard | Phase 3 |
| Session manager | `session-manager.ts` — `SessionManager` class: multi-client broadcast, async SDK loop, `canUseTool` permission round-trip, DB session rows, `encodeMsg`/`parseClientMsg` pure helpers | Phase 3 |
| WS server | `ws-server.ts` — `attachWebSocketServer()`: HTTP upgrade, session-cookie auth, hands off to `ws-handler.ts` | Phase 3 |
| WS handler | `ws-handler.ts` — routes `message` / `permission_response` / `interrupt` to session manager; auto-starts session on first message | Phase 3 |
| Custom server | `src/server.ts` — production entry point (replaces adapter-node default); attaches WS to same HTTP server | Phase 3 |
| Vite WS plugin | `wsDevPlugin` in `vite.config.ts` — attaches WS handler to Vite dev server on `listening` | Phase 3 |
| Session REST API | `GET /api/session` (state), `DELETE /api/session` (interrupt) | Phase 3 |
| Unit tests | 139 tests across 10 suites; coverage 93.3% stmts / 89.4% branches / 90.8% fns | Phase 3 |
| Chat UI | `/` — full chat page: streaming text, tool call cards, permission prompt bottom sheet, session state indicator, cost display | Phase 4 |
| Chat components | `Message.svelte`, `ToolCallCard.svelte` (collapsible), `PermissionPrompt.svelte` (bottom sheet), `DiffViewer.svelte`, `CommandBar.svelte` (slash cmd, auto-grow, interrupt) | Phase 4 |
| WS client | WebSocket connection with auto-reconnect; streams `text`/`tool_start`/`tool_end`/`permission_request`/`session_state`/`cost`/`error` | Phase 4 |
| E2E tests | Playwright installed; `e2e/` tests for setup, login, and chat page structure; full chat tests scaffolded (skipped; require live server) | Phase 4 |

### Not yet built
Phase 5 (Vault/Git), Phase 6 (OAuth polling), Phase 7 (prod hardening).

### Next up → Phase 5

---

## What Changed From v1 (and Why)

The original plan assumed users could link their claude.ai subscription via OAuth to run Claude
Code on your server on their behalf. This is **explicitly prohibited by Anthropic's ToS** (updated
Feb 17-18 2026): third-party developers may not offer claude.ai login or subscription rate limits
for their products — and GitHub issue #6536 requesting SDK support for this was closed as
"not planned."

**New model**: Each person deploys their own instance. They authenticate their own Claude
account during the one-time setup wizard. Their subscription is used by their own VPS — no
third party involved, just you running Claude Code on a computer you own.

Side effects of this pivot:
- No Google OAuth, no multi-user system, no admin panel
- No per-user isolation complexity
- The whole codebase is dramatically simpler
- The deploy story becomes "clone, run setup, done"

---

## Design Decisions

### 1. Mobile-First PWA
Every screen is designed for a phone screen. Nothing assumes a mouse or wide viewport.
Safe area insets, touch targets ≥ 44px, proper `apple-mobile-web-app-*` tags.

### 2. Single-User, Passkey-Protected (WebAuthn)
The setup wizard registers a **Passkey** — a hardware-backed key pair generated by your phone's
secure enclave. No password to create, remember, or leak. Future logins use Face ID / Touch ID /
biometrics via the browser's native WebAuthn API. A session cookie (30-day, HttpOnly, Secure) is
issued after successful authentication.

Libraries: `@simplewebauthn/server` (Node) + `@simplewebauthn/browser` (client).
The public key and credential ID are stored in the `config` table (single user = single
credential). If you lose your device, re-registration is done directly from the VPS via a
one-time CLI command (`npm run reset-auth`) which clears the stored credential.

### 3. Claude Auth via OAuth Setup Page
On first setup, the wizard walks you through authenticating with your Claude account.
The VPS initiates the CLI's PKCE OAuth flow. Since the callback URI is fixed to
`https://console.anthropic.com/oauth/code/callback` (Anthropic-controlled), we use a
**two-phase approach**:

- **Primary (browser-initiated)**: VPS generates PKCE params + state. You're redirected to
  `claude.ai/oauth/authorize`. After you authenticate, Anthropic's callback page handles the
  code. The VPS polls a known Anthropic endpoint using the `state` value to retrieve the
  authorization code (replicating the CLI's internal polling mechanism — to be reverse-engineered
  from the CLI binary or confirmed via network traffic inspection).

- **Fallback (token paste)**: If the polling mechanism can't be confirmed, the setup wizard
  shows a "run this command and paste the result" step: `claude setup-token`. This is
  Anthropic's own headless mechanism and always works. The VPS stores the token as
  `CLAUDE_CODE_OAUTH_TOKEN`.

The VPS stores credentials in `~/.claude/credentials.json` (same format as the CLI) or in
the app's SQLite config. Token refresh is handled via the refresh token.

### 4. Claude Agent SDK — Host-Side
The `@anthropic-ai/claude-agent-sdk` runs on the VPS host. It spawns Claude Code CLI as a
subprocess. Two integration points matter here:

- **`options.env`** — this is where `CLAUDE_CODE_OAUTH_TOKEN` is injected per session
- **`options.canUseTool`** — async callback that resolves to allow/deny. This is how permission
  prompts work: the callback suspends the session and sends a `permission_request` event over
  WebSocket; when the user taps Allow/Deny on their phone, the callback resolves.

There is no `apiKey` param — credentials are entirely env-based.

### 5. Docker for Tool Execution Isolation
The SDK spawns the Claude Code CLI as a subprocess. That CLI's Bash tool runs shell commands
on the host — which is unacceptable on a shared machine. Solution: `pathToClaudeCodeExecutable`
is set to a wrapper script that runs `claude` **inside a Docker container** via `docker exec`.

The VPS maintains one persistent "workspace container" (or one per active session). The container
has Python, Node.js, Git, all standard tools, and the user's vault mounted. The host-side SDK
communicates with the containerised CLI via subprocess stdin/stdout (docker exec -i bridges this
naturally).

Resource limits are applied at container creation time.

### 6. Full Claude Code Experience
Same as before: streaming text, tool call cards, file diffs, `/commands`, and permission prompts
with approve/deny on mobile.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Phone                                                   │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │ Obsidian App │   │ Chrome/Safari PWA               │  │
│  │ + Git plugin │   │  Chat UI                        │  │
│  │              │   │  Settings                        │  │
│  │              │   │  Setup wizard (first run)        │  │
│  └──────┬───────┘   └──────────────┬─────────────────┘  │
└─────────┼──────────────────────────┼────────────────────┘
          │ git push/pull            │ WebSocket + HTTPS
          ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│  Your VPS (Ubuntu 24.04)                                 │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Caddy  (reverse proxy, auto-HTTPS, port 443)     │   │
│  └──────────────────────┬─────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────┐    │
│  │ SvelteKit App  (Node, port 3000/3001)            │    │
│  │                                                  │    │
│  │  Pages                                           │    │
│  │    /          → chat UI (login-gated)            │    │
│  │    /setup     → first-time setup wizard          │    │
│  │    /login     → password entry                   │    │
│  │    /settings  → Claude auth status, vault config │    │
│  │    /monitor   → system health, usage stats       │    │
│  │                                                  │    │
│  │  API routes                                      │    │
│  │    /api/auth/register    WebAuthn registration   │    │
│  │    /api/auth/login       WebAuthn authentication │    │
│  │    /api/health           JSON health check       │    │
│  │    /api/setup/*          setup wizard steps      │    │
│  │    /api/session/*        start/stop/status       │    │
│  │    /api/ws               WebSocket upgrade        │    │
│  └──────────────────────┬─────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────┐    │
│  │ Session Manager (in-process Node.js module)     │    │
│  │  - Calls @anthropic-ai/claude-agent-sdk query() │    │
│  │  - pathToClaudeCodeExecutable → docker-exec.sh  │    │
│  │  - canUseTool → WebSocket permission round-trip  │    │
│  │  - Bridges SDK message stream → WebSocket        │    │
│  │  - CLAUDE_CODE_OAUTH_TOKEN injected via env      │    │
│  └───────────────────────┬──────────────────────┘     │
│                          │ docker exec -i               │
│  ┌───────────────────────▼──────────────────────┐     │
│  │ Workspace Container (Docker)                  │     │
│  │  ubuntu:24.04                                 │     │
│  │  claude (CLI binary)                          │     │
│  │  Python 3 + pip + uv                          │     │
│  │  Node.js + npm                                │     │
│  │  Git, ripgrep, fd, jq, curl                   │     │
│  │  /vault  ← bind-mounted from host             │     │
│  │  Resource limits: memory, CPU, pids           │     │
│  └───────────────────────────────────────────────┘     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ SQLite  ./data/app.db                            │   │
│  │  config: key, value  (credentials, vault path)   │   │
│  │  sessions: id, started_at, ended_at, status      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  /var/vault/  ← git bare repo (Obsidian pushes here)    │
└──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend + API | SvelteKit | Small bundle, fast on mobile, great PWA support |
| Styling | Tailwind CSS | Utility-first, enforces mobile-first discipline |
| Auth | Passkeys / WebAuthn | Hardware-backed biometric auth, no password to leak |
| Claude auth | Claude.ai OAuth (own account) | Your subscription, your VPS, no ToS issue |
| Claude SDK | `@anthropic-ai/claude-agent-sdk` | Official SDK with `canUseTool`, streaming, env injection |
| Container | Docker (single workspace container) | Bash tool isolation, Python/Node environment |
| Container bridge | `pathToClaudeCodeExecutable` wrapper | SDK on host, Claude CLI in container |
| Database | SQLite via Drizzle ORM | Zero-config, no network, perfect for single-user |
| Reverse proxy | Caddy | Auto-HTTPS, one-line config |
| Vault sync | Git bare repo on VPS | Obsidian Git plugin push/pulls natively |

---

## Project Structure

```
obsidian-claude-code/
├── PLAN.md                        ✓
├── .env.example                   ✓
├── .github/workflows/ci.yml       ✓  vitest + coverage gate on every PR
│
├── docker-compose.yml             ← Phase 7
├── Caddyfile                      ← Phase 7
│
├── container/                     ✓  Phase 3
│   ├── Dockerfile                 ✓  ubuntu:24.04, Node LTS, Claude CLI, uv
│   └── docker-exec-wrapper.sh    ✓  pathToClaudeCodeExecutable bridge
│
└── app/
    ├── package.json               ✓
    ├── svelte.config.js           ✓  adapter-node
    ├── vite.config.ts             ✓  Tailwind v4, vitest config, wsDevPlugin
    ├── drizzle.config.ts          ✓
    ├── drizzle/                   ✓  initial migration generated
    └── src/
        ├── app.html               ✓  PWA + iOS meta tags
        ├── app.css                ✓  Tailwind import
        ├── test-setup.ts          ✓  vitest global env vars
        ├── server.ts              ✓  custom prod entry — HTTP + WS on same port
        ├── hooks.server.ts        ✓  setup + auth route guards
        ├── service-worker.ts      ← Phase 7
        │
        ├── lib/server/
        │   ├── crypto.ts          ✓  AES-256-GCM encrypt/decrypt
        │   ├── monitor.ts         ✓  health + monitor snapshots, pure parsers exported
        │   ├── docker.ts          ✓  container lifecycle (getContainerState, ensureRunning, stop)
        │   ├── session-manager.ts ✓  SessionManager: SDK loop, canUseTool bridge, WS broadcast
        │   ├── ws-handler.ts      ✓  per-connection handler (routes msgs to SessionManager)
        │   ├── ws-server.ts       ✓  attachWebSocketServer() — auth + upgrade
        │   ├── db/
        │   │   ├── schema.ts      ✓  config + sessions tables
        │   │   └── index.ts       ✓  drizzle instance, getConfig/setConfig/deleteConfig
        │   ├── auth/
        │   │   ├── webauthn.ts    ✓  registration + authentication ceremonies
        │   │   └── session.ts     ✓  HMAC-signed cookie, createSession/getSession
        │   ├── claude/
        │   │   ├── oauth.ts       ✓  PKCE flow, token refresh, storeTokens/loadTokens
        │   └── git.ts             ← Phase 5  bare repo management
        │
        ├── lib/components/        ✓  Phase 4
        │   ├── chat/
        │   │   ├── Message.svelte          ✓  user/assistant bubbles
        │   │   ├── ToolCallCard.svelte     ✓  collapsible, input/output
        │   │   ├── DiffViewer.svelte       ✓  unified diff renderer
        │   │   ├── PermissionPrompt.svelte ✓  bottom sheet approve/deny
        │   │   └── CommandBar.svelte       ✓  auto-grow input, slash cmd, interrupt
        │   └── ui/
        │
        ├── lib/ws-protocol.ts     ✓  WsServerMsg / WsClientMsg types + isClientMsg guard
        │
        └── routes/
            ├── +layout.svelte     ✓  bottom nav (Chat / Monitor / Settings)
            ├── +page.svelte       ✓  chat UI: WS client, message list, streaming, permissions
            ├── login/+page.svelte ✓  WebAuthn authenticate
            ├── setup/+page.svelte ✓  wizard: passkey → token → vault
            ├── monitor/           ✓  +page.svelte + +page.server.ts
            ├── settings/          ✓  +page.svelte + +page.server.ts
            └── api/
                ├── auth/register/ ✓  WebAuthn registration ceremony
                ├── auth/login/    ✓  WebAuthn authentication ceremony
                ├── health/        ✓  unauthenticated JSON health check
                ├── monitor/       ✓  authenticated full snapshot
                ├── settings/
                │   └── claude/token/ ✓  update token post-setup (auth-gated)
                ├── setup/
                │   ├── claude/token/ ✓  save token, mark setup complete
                │   ├── claude/start/ ← Phase 6  initiate PKCE OAuth
                │   ├── claude/poll/  ← Phase 6  poll for auth code
                │   └── vault/     ✓  init git repo, return push URL
                ├── session/       ✓  GET (state) + DELETE (interrupt)
                └── ws/            ✓  WebSocket upgrade (via ws-server.ts + vite plugin)
```

---

## Claude Auth Flow (OAuth Setup Page)

The `container/docker-exec-wrapper.sh` sets `pathToClaudeCodeExecutable` so the SDK's subprocess
runs inside Docker. Separately, Claude credentials are managed by the VPS:

### Phase 1 implementation (reliable fallback): Token paste

```
Setup wizard step 2:

  "Authenticate with Claude"

  1. Click "Open Claude in browser" →
     opens https://claude.ai/oauth/authorize?client_id=9d1c250a-...&...

  2. Complete login in browser

  3. In a terminal on your local machine, run:
       claude setup-token
     Copy the token shown.

  4. Paste token here: [________________]
     [ Save ]
```

The VPS stores it as `CLAUDE_CODE_OAUTH_TOKEN` in the config table (encrypted).

### Phase 2 (future): Full polling-based browser OAuth

Once the CLI's state-polling mechanism is confirmed (by inspecting CLI network traffic), the
wizard can be fully browser-driven with no copy-paste step. The VPS will:
1. Generate PKCE params + state, return OAuth URL to browser
2. User completes OAuth in browser (redirect goes to console.anthropic.com)
3. VPS polls `https://console.anthropic.com/api/oauth/pending?state=<state>` (or equivalent)
   until it receives the authorization code
4. VPS exchanges code + code_verifier for access + refresh tokens
5. Store credentials, proceed to next setup step

---

## Docker Container Bridge

`container/docker-exec-wrapper.sh`:
```bash
#!/bin/bash
# Called by @anthropic-ai/claude-agent-sdk as the Claude Code executable.
# Forwards all arguments and stdin/stdout to the workspace container.
exec docker exec -i claude-workspace claude "$@"
```

Session manager sets:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: userMessage,
  options: {
    pathToClaudeCodeExecutable: "/opt/obsidian-claude-code/docker-exec-wrapper.sh",
    cwd: "/vault",
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: storedOAuthToken,
    },
    permissionMode: "default",   // triggers canUseTool for sensitive operations
    canUseTool: async (tool, input) => {
      // suspend and send permission_request over WebSocket
      // await user approve/deny on phone
      return awaitPermissionFromWebSocket(tool, input);
    },
  }
})) {
  // forward msg to WebSocket client
}
```

---

## WebSocket Protocol

All messages are JSON. Connection requires `Authorization: Bearer <session-token>` header or
`?token=` query param (the session token from the login cookie).

### Server → Client

```ts
{ type: 'text',              content: string }
{ type: 'tool_start',        tool: string, input: Record<string, unknown> }
{ type: 'tool_end',          tool: string, output: string }
{ type: 'permission_request', id: string, tool: string, command: string, description: string }
{ type: 'diff',              file: string, patch: string }
{ type: 'session_state',     state: 'idle' | 'running' | 'waiting_permission' | 'error' | 'done' }
{ type: 'cost',              total_usd: number }
{ type: 'error',             message: string }
```

### Client → Server

```ts
{ type: 'message',             content: string }
{ type: 'permission_response', id: string, allow: boolean }
{ type: 'interrupt' }
```

---

## Database Schema (Drizzle + SQLite)

```ts
// Key-value config store
config {
  key    text primary key   // e.g. 'password_hash', 'oauth_token', 'vault_path'
  value  text               // encrypted for sensitive keys
}

// Session history
sessions {
  id           text primary key   // uuid
  started_at   integer
  ended_at     integer
  status       text    // 'running' | 'stopped' | 'error'
  turn_count   integer
  cost_usd     real
}
```

That's the entire schema. No users table. No per-user anything.

---

## Workspace Container (Dockerfile)

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git python3 python3-pip python3-venv \
    ripgrep fd-find jq wget unzip \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs

# uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Non-root user
RUN useradd -m -s /bin/bash claude
USER claude
WORKDIR /home/claude

VOLUME /vault
```

Container is started once and kept alive across sessions (no startup latency):
```
docker run -d \
  --name claude-workspace \
  --memory=1g \
  --cpus=1.0 \
  --pids-limit=200 \
  --network=claude-net \
  -v /var/vault:/vault \
  claude-workspace-image
```

---

## Docker Compose

Single `docker-compose.yml` with a `DEV=true` env flag to toggle dev vs prod settings:

```yaml
services:
  app:
    build: ./app
    volumes:
      - ./data:/data          # SQLite
      - /var/run/docker.sock:/var/run/docker.sock  # to manage workspace container
      - ./container/docker-exec-wrapper.sh:/usr/local/bin/docker-exec-wrapper.sh
    environment:
      - DATABASE_URL=/data/app.db
      - VAULTS_DIR=/var/vault
    ports:
      - "3000:3000"

  caddy:
    image: caddy:2-alpine
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    ports:
      - "80:80"
      - "443:443"
```

---

## Setup Wizard Flow ✓ (built)

```
First visit (not set up) → /setup

  Step 1: Create your passkey
          [Create Passkey] → browser prompts Face ID / Touch ID / hardware key
          POST /api/auth/register (WebAuthn registration ceremony)

  Step 2: Link Claude account
          Instructions to run `claude setup-token` locally.
          [textarea: paste sk-ant-oat01-…] → POST /api/setup/claude/token
          Token encrypted with AES-256-GCM, stored in config table.
          setup_complete = 'true' set here; session cookie issued immediately.

  Step 3: Configure vault
          [input: /var/vault] → POST /api/setup/vault
          Creates directory + git init if needed.
          Returns git push URL shown to user (copy for Obsidian Git plugin).

  → redirect to /

Subsequent visits → /login
  [Use Passkey] → browser biometric prompt → POST /api/auth/login
  → 30-day session cookie → redirect to return_to or /
```

---

## Key Env Vars (`.env.example`)

```
# Required
APP_SECRET=           # random 32+ char string for signing cookies
ENCRYPTION_KEY=       # random 32-byte hex for encrypting tokens at rest
DATABASE_URL=/data/app.db

# Domain (used by Caddy + OAuth callback)
PUBLIC_URL=https://your-vps.example.com

# Vault
VAULTS_DIR=/var/vault

# Optional overrides
PORT=3000
NODE_ENV=production
```

No Google credentials, no Claude OAuth client ID/secret (we use the CLI's public client).

---

## Monitoring

### `/api/health` — unauthenticated JSON endpoint
For external uptime monitors (UptimeRobot, Betterstack, etc.).

```json
{
  "status": "ok",
  "uptime_seconds": 43200,
  "setup_complete": true,
  "container_status": "running",
  "claude_token_valid": true,
  "claude_token_expires_in_seconds": 14400,
  "vault_last_push": "2026-02-22T08:15:00Z",
  "version": "0.1.0"
}
```

Returns `503` with `"status": "degraded"` if container is not running or token is expired.

### `/monitor` — authenticated PWA page
Mobile dashboard showing:

| Section | Metrics |
|---|---|
| **System** | VPS CPU %, RAM used/total, disk used/total |
| **Container** | Status (running/stopped), uptime, restart button |
| **Current session** | Active?, model, turns, cost so far |
| **Usage (30 days)** | Total sessions, total cost USD, avg session length |
| **Vault** | Last push timestamp, branch, uncommitted file count |
| **Claude auth** | Token expires in, last refreshed, "Re-authenticate" button |

`monitor.ts` reads from:
- `/proc/meminfo` + `/proc/stat` — host CPU/RAM
- `df` syscall or `/proc/mounts` — disk usage
- Docker Engine API (`/var/run/docker.sock`) — container status
- SQLite sessions table — usage aggregates

---

## Testing Strategy

### Philosophy: tests ship with the code, not after it
Every phase includes tests for the server logic added in that phase.
Tests are not a separate phase — they are part of "done."

### Tooling

| Tool | Purpose |
|---|---|
| `vitest` | Unit and integration tests (Node environment) |
| `@vitest/coverage-v8` | Coverage reports via V8 instrumentation |
| `@playwright/test` | E2E browser tests (Phase 4+, when UI is stable) |

### What gets tested at each layer

**Unit tests (Vitest, `src/**/*.test.ts`)**
Pure logic with no external dependencies. Fast, no setup needed.

| Module | What to test |
|---|---|
| `crypto.ts` | encrypt/decrypt round-trips, tampered ciphertext, bad key |
| `auth/session.ts` | sign/verify, tampered cookie, missing cookie |
| `monitor.ts` (pure parsers) | `/proc/meminfo` parsing, `/proc/stat` parsing, df output, token expiry logic |
| `db/index.ts` | getConfig/setConfig/deleteConfig with temp SQLite |

**Integration tests (Vitest + real dependencies)**
Modules that talk to Docker, git, or the Claude SDK get integration tests
that run against real local instances in CI (Docker-in-Docker). Skipped
locally if Docker is not present.

| Module | What to test |
|---|---|
| `docker.ts` | container start/stop/exec lifecycle |
| `claude/oauth.ts` | PKCE generation, token exchange (HTTP mock) |
| `session-manager.ts` | WebSocket bridge, canUseTool round-trip (SDK mocked) |

**E2E tests (Playwright, `e2e/**/*.test.ts`)**
Full browser flows. Added in Phase 4 once the UI is non-trivial.

| Flow | What to test |
|---|---|
| Setup wizard | Register passkey → paste token → vault config → redirect to `/` |
| Login | Passkey authenticate → session cookie → protected route access |
| Chat | Send message → see streaming response → permission prompt → approve |

### Coverage targets

Unit test coverage is enforced in CI:
- Statements: ≥ 80%
- Branches: ≥ 75%
- Functions: ≥ 80%

Integration and E2E tests are not included in the coverage threshold —
they run as a separate CI job.

### Design rule for testability
Pure parsing logic is always exported from modules so it can be tested
without mocking IO. Functions that read files or exec commands call the
pure parsers and are tested via integration tests or with mocked IO.

---

## Implementation Phases

### Phase 1 — Foundation ✓ complete
1. ✓ SvelteKit app scaffold: Tailwind v4, adapter-node, PWA manifest + iOS meta tags
2. ✓ Drizzle schema (config + sessions tables), initial migration, `getConfig`/`setConfig`/`deleteConfig`
3. ✓ AES-256-GCM encryption (`crypto.ts`) for sensitive config values
4. ✓ Passkey auth: `@simplewebauthn/server`, HMAC-signed session cookie, route guard (`hooks.server.ts`)
5. ✓ Setup wizard: passkey registration → Claude token paste → vault path config
6. ✓ Login page with WebAuthn biometric prompt
7. ✓ `monitor.ts` with exported pure parsers; `/api/health` (200/503); `/api/monitor`; `/monitor` page (auto-refresh 30s)
8. ✓ `.env.example`
9. ✓ Vitest + `@vitest/coverage-v8`; 46 unit tests passing; 80/75/80 coverage thresholds
10. ✓ GitHub Actions CI (`.github/workflows/ci.yml`): runs `test:coverage` on every PR, blocks merge on threshold miss

### Phase 2 — Claude Auth  ✓ complete
1. ✓ `claude/oauth.ts`: PKCE generation, OAuth URL construction, `needsRefresh`
2. ✓ Setup wizard Claude auth step (token-paste path) — uses `storeTokens`
3. ✓ Token storage (encrypted in config table via `storeTokens`/`loadTokens`)
4. ✓ Token refresh logic — `refreshAccessToken` (mocked-HTTP tested; endpoint confirmed in Phase 6)
5. ✓ Settings page: token status, "re-authenticate" button, vault path + Git URL copy
6. ✓ **Unit tests**: PKCE helpers, `needsRefresh`, `storeTokens`/`loadTokens`, `refreshAccessToken` (mocked fetch)
7. ✓ `/api/settings/claude/token` POST — updates token from settings (auth-gated)

### Phase 3 — Container + Session Manager  ✓ complete
1. ✓ `container/Dockerfile` — ubuntu:24.04, Node LTS, Claude CLI, uv, non-root `claude` user
2. ✓ `container/docker-exec-wrapper.sh` — `pathToClaudeCodeExecutable` bridge to `docker exec -i`
3. ✓ `docker.ts` — `getContainerState`, `ensureContainerRunning`, `stopContainer`; `parseInspectStatus` exported for unit tests
4. ✓ `session-manager.ts` — `SessionManager` class: multi-client broadcast, async SDK loop with streaming user input queue, `canUseTool` permission round-trip (5-min timeout), DB session rows; `encodeMsg`/`parseClientMsg` pure helpers
5. ✓ `ws-handler.ts` — per-connection message routing; auto-starts session on first user message
6. ✓ `ws-server.ts` — `attachWebSocketServer()`: session-cookie auth on upgrade, routes to `ws-handler`
7. ✓ `src/server.ts` — custom production server entry; attaches WS to same HTTP port as SvelteKit
8. ✓ `wsDevPlugin` in `vite.config.ts` — attaches WS to Vite dev server on `listening`
9. ✓ `GET /api/session` + `DELETE /api/session` — state query + interrupt
10. ✓ **Unit tests**: 139 tests total, 10 suites; coverage 93.3% stmts / 89.4% branches / 90.8% fns

### Phase 4 — Chat UI  ✓ complete
1. ✓ Message list with streaming text (`MessageList` via `+page.svelte`, `Message.svelte`)
2. ✓ Tool call cards — collapsible, shows tool name + input + output (`ToolCallCard.svelte`)
3. ✓ Permission prompt — bottom sheet, approve/deny (`PermissionPrompt.svelte`)
4. ✓ Diff viewer — mobile unified diff renderer (`DiffViewer.svelte`)
5. ✓ `/command` slash input — `CommandBar.svelte`: auto-grow textarea, slash cmd badge, send/interrupt
6. ✓ Session state indicator + cost display — header pulse dot, `$` cost badge
7. ✓ WS client — auto-reconnect, streams all message types, optimistic user messages
8. ✓ **E2E tests (Playwright)**: `@playwright/test` installed; `e2e/` with setup, login, chat tests

### Phase 5 — Vault / Git
1. Git bare repo at `/var/vault`
2. Git HTTP backend via Caddy (or SSH — TBD based on Obsidian Git plugin support)
3. Container vault mount at session start
4. Settings page: show the push URL, copy button
5. **Integration tests**: bare repo init, push URL generation, git HTTP auth

### Phase 6 — OAuth Polling (Phase 2 upgrade)
1. Reverse-engineer CLI polling mechanism (network inspection of `claude auth` run)
2. Implement `setup/claude/start` + `setup/claude/poll` server routes
3. Add fully browser-based auth path to setup wizard (no terminal step)
4. **Unit tests**: polling state machine, PKCE challenge/verifier generation

### Phase 7 — Production Hardening
1. `docker-compose.yml` prod target
2. Caddy config with HTTPS
3. Container resource limits (memory, CPU, PIDs)
4. Network isolation (`claude-net` bridge, no host access)
5. Log rotation, startup script / systemd unit
   ~~CI pipeline~~ — done in Phase 1

---

## Decisions Still Open

- **Git auth for vault sync**: HTTPS (basic auth via Caddy, simpler) vs SSH (better Obsidian Git
  plugin support). Lean HTTPS first, add SSH if needed.
- **Container lifecycle**: Keep workspace container running 24/7 vs start/stop per session.
  24/7 is simpler (no startup latency, vault always mounted). Start with always-on.
- **OAuth polling endpoint**: Needs to be confirmed by inspecting CLI network traffic before
  Phase 6. If no clean polling API exists, the token-paste flow (Phase 2) is the permanent UX.
- **Multiple concurrent sessions**: Out of scope for now. Single active session at a time.
  Session interrupts the previous one if another is started.
