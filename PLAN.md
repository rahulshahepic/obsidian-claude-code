# Obsidian Claude Code — Architecture Plan

## What This Is

A self-hosted web app (PWA) that lets you run Claude Code sessions from your phone, with
your Obsidian vault synced via Git. You chat with Claude Code, it reads/writes your notes,
and the Obsidian Android/iOS app syncs changes via the Obsidian Git plugin.

---

## Design Decisions (Non-Negotiable)

### 1. Mobile-First, No Desktop Assumptions
Every screen — chat, admin, monitoring, settings, debug — is designed for a phone screen
first. Nothing assumes a mouse, hover state, or wide viewport.

### 2. User Approval Workflow
New users who sign in land in `pending` state and cannot start sessions until an admin
approves them. The deploy script seeds an initial admin by Google email; that account
is both a normal user and an admin. The admin panel is a mobile-first screen in the
same SvelteKit app.

### 3. Two-Factor Auth (Identity + Subscription)
- **Google OAuth** — identifies who you are, creates/restores your web app session
- **Claude.ai OAuth** — links your Claude subscription so Claude Code runs on *your*
  claude.ai account (Claude Max/Pro). You absorb zero API costs.

After admin approval, users are prompted to complete the Claude.ai OAuth link. Once both
are done, they can start sessions. Claude credentials are stored encrypted in SQLite per
user and injected into their container at session start.

### 4. iOS + Android PWA
Both platforms. Known iOS PWA limits to work around:
- No background sync (not needed — vault sync is Git-based via Obsidian app)
- Proper `apple-mobile-web-app-*` meta tags
- Avoid features not supported in Safari (no push notifications initially)
- Safe area insets (`env(safe-area-inset-*)`) everywhere

### 5. Powerful but Isolated User Containers
Each user's Claude Code session runs in a Docker container with:
- Claude Code CLI (via `@anthropic-ai/claude-code` SDK or binary)
- Python 3 + pip + uv
- Node.js + npm
- Git
- ripgrep, fd, jq, curl, wget
- Resource limits: CPU quota, memory limit, disk quota
- Network: can reach the internet (for Claude API), cannot reach host network or other
  user containers

### 6. Full Claude Code Experience
The WebSocket protocol between browser and server exposes *all* Claude Code events:
- Streaming text output
- File diffs (rendered as mobile-friendly unified diffs)
- `/commands` (passed through to Claude Code)
- Tool calls visible to user (which tool, which args)
- **Permission prompts**: when Claude Code wants to run bash or write files, the UI shows
  a mobile-friendly approve/deny dialog. Response goes back to the session.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Phone (Android or iOS)                                  │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │ Obsidian App │   │ Chrome/Safari PWA               │  │
│  │ + Git plugin │   │  Chat UI                        │  │
│  │              │   │  Admin Panel (if admin)          │  │
│  │              │   │  Settings / API key link         │  │
│  └──────┬───────┘   └──────────────┬─────────────────┘  │
└─────────┼──────────────────────────┼────────────────────┘
          │ git push/pull            │ WebSocket + HTTPS
          ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│  VPS (Hetzner CX22 — Ubuntu 24.04)                       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Caddy  (reverse proxy, auto-HTTPS, port 443)     │   │
│  └──────────────────────┬─────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────┐    │
│  │ SvelteKit App  (port 3000 dev / 3001 prod)      │    │
│  │                                                  │    │
│  │  Pages                                           │    │
│  │    /          → chat UI                          │    │
│  │    /admin     → user approval, session monitor   │    │
│  │    /settings  → Claude.ai link, API key, prefs   │    │
│  │    /auth/*    → Google + Claude.ai OAuth flows   │    │
│  │                                                  │    │
│  │  API routes (SvelteKit server)                   │    │
│  │    /api/auth/*        OAuth callbacks            │    │
│  │    /api/admin/*       User management            │    │
│  │    /api/session/*     Start/stop sessions        │    │
│  │    /api/ws            WebSocket upgrade           │    │
│  └──────────────────────┬─────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────┐    │
│  │ Session Manager (Node.js service, same process) │    │
│  │  - Spawns/stops Docker containers per user      │    │
│  │  - Bridges WebSocket ↔ Claude Code SDK events   │    │
│  │  - Manages permission prompt round-trips        │    │
│  │  - Handles user vault directories               │    │
│  └───────────┬────────────────────┬───────────────┘    │
│              │                    │                      │
│  ┌───────────▼──────┐  ┌─────────▼──────────────┐     │
│  │ User Container 1 │  │ User Container 2 ...    │     │
│  │  Claude Code CLI │  │  Claude Code CLI        │     │
│  │  Python, Node    │  │  Python, Node           │     │
│  │  /vault (git)    │  │  /vault (git)           │     │
│  │  ~/.claude/creds │  │  ~/.claude/creds        │     │
│  └──────────────────┘  └─────────────────────────┘     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ SQLite (via Drizzle ORM)                         │   │
│  │  users: id, google_id, email, role, status       │   │
│  │  claude_creds: user_id, encrypted_tokens         │   │
│  │  sessions: id, user_id, container_id, started_at │   │
│  │  git_repos: user_id, repo_path, remote_url       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Git bare repos  /var/vaults/<user_id>.git        │   │
│  │  (phone pushes here, container clones from here) │   │
└──────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend + API | SvelteKit | Small bundle, fast on mobile, great PWA support, single codebase |
| Styling | Tailwind CSS (mobile-first) | Utility-first, easy to enforce mobile-first patterns |
| Auth (identity) | Google OAuth 2.0 | Reliable IDP, widely used, works on all devices |
| Auth (Claude) | Claude.ai OAuth | Users use their own subscription, no API cost to server |
| Database | SQLite via Drizzle ORM | Zero-config, fast, perfect for single-VPS scale |
| Claude Code | `@anthropic-ai/claude-code` SDK | Programmatic session control, event streaming |
| Containers | Docker + Docker Compose | Isolate user sessions, resource limits |
| Reverse Proxy | Caddy | Auto-HTTPS with one line config |
| Vault Sync | Git bare repos on VPS | Obsidian Git plugin pushes/pulls natively |

---

## Project Structure

```
obsidian-claude-code/
├── PLAN.md                        ← this file
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── Caddyfile
├── .env.example
│
├── container/                     ← Docker image for user sessions
│   ├── Dockerfile                 ← Claude Code + Python + Node + tools
│   └── entrypoint.sh
│
└── app/                           ← SvelteKit application
    ├── package.json
    ├── svelte.config.js
    ├── vite.config.ts
    ├── src/
    │   ├── app.html               ← PWA meta tags (iOS + Android)
    │   ├── service-worker.ts      ← PWA offline shell
    │   │
    │   ├── lib/
    │   │   ├── server/
    │   │   │   ├── db/
    │   │   │   │   ├── schema.ts  ← Drizzle schema
    │   │   │   │   └── index.ts   ← DB connection
    │   │   │   ├── auth/
    │   │   │   │   ├── google.ts  ← Google OAuth helpers
    │   │   │   │   └── claude.ts  ← Claude.ai OAuth helpers
    │   │   │   ├── session-manager.ts  ← spawn/stop containers, WS bridge
    │   │   │   ├── docker.ts      ← Docker API wrapper
    │   │   │   └── git.ts         ← bare repo management
    │   │   │
    │   │   ├── components/
    │   │   │   ├── chat/
    │   │   │   │   ├── MessageList.svelte
    │   │   │   │   ├── Message.svelte
    │   │   │   │   ├── DiffViewer.svelte   ← mobile-friendly unified diff
    │   │   │   │   ├── PermissionPrompt.svelte  ← approve/deny dialog
    │   │   │   │   ├── ToolCallCard.svelte
    │   │   │   │   └── CommandBar.svelte   ← / commands input
    │   │   │   ├── admin/
    │   │   │   │   ├── UserList.svelte
    │   │   │   │   ├── SessionMonitor.svelte
    │   │   │   │   └── ApproveCard.svelte
    │   │   │   └── ui/            ← shared primitives (Button, Sheet, etc.)
    │   │   │
    │   │   └── ws-protocol.ts     ← TypeScript types for WebSocket messages
    │   │
    │   └── routes/
    │       ├── +layout.svelte     ← mobile shell, bottom nav
    │       ├── +page.svelte       ← chat UI
    │       ├── admin/
    │       │   └── +page.svelte   ← admin panel (guarded)
    │       ├── settings/
    │       │   └── +page.svelte   ← link Claude account, git config
    │       └── api/
    │           ├── auth/
    │           │   ├── google/callback/+server.ts
    │           │   └── claude/callback/+server.ts
    │           ├── admin/
    │           │   └── users/+server.ts
    │           ├── session/
    │           │   └── +server.ts
    │           └── ws/
    │               └── +server.ts  ← WebSocket upgrade
    │
    └── static/
        ├── manifest.json           ← PWA manifest
        └── icons/                  ← PWA icons (various sizes)
```

---

## WebSocket Protocol

All messages are JSON. Two directions: **server→client** and **client→server**.

### Server → Client

```ts
// Streamed text from Claude
{ type: 'text', content: string }

// A tool Claude Code is invoking
{ type: 'tool_start', tool: string, input: Record<string, unknown> }

// Tool finished
{ type: 'tool_end', tool: string, output: string }

// Claude Code wants to run something — must be approved
{ type: 'permission_request', id: string, tool: string, command: string, description: string }

// A file diff to display
{ type: 'diff', file: string, patch: string }

// Session state changes
{ type: 'session_state', state: 'idle' | 'running' | 'waiting_permission' | 'error' }

// Error
{ type: 'error', message: string }
```

### Client → Server

```ts
// User message or /command
{ type: 'message', content: string }

// Response to a permission_request
{ type: 'permission_response', id: string, allow: boolean }

// Interrupt current run (Ctrl+C equivalent)
{ type: 'interrupt' }
```

---

## User States & Auth Flow

```
[new google sign-in]
        │
        ▼
   status: pending
   (cannot start sessions)
        │
        ▼ (admin approves in admin panel)
   status: approved
   (prompted to link Claude.ai account)
        │
        ▼ (Claude.ai OAuth complete)
   status: active
   (can start sessions)

Admin account: seeded by deploy script with google_email + role: 'admin'
Admin goes through the same flow but starts at approved.
```

---

## Database Schema (Drizzle)

```ts
users {
  id          text primary key  // uuid
  google_id   text unique
  email       text
  name        text
  role        text  // 'user' | 'admin'
  status      text  // 'pending' | 'approved' | 'active' | 'suspended'
  created_at  integer
}

claude_credentials {
  user_id         text  // fk → users.id
  access_token    text  // encrypted
  refresh_token   text  // encrypted
  expires_at      integer
}

sessions {
  id            text primary key
  user_id       text  // fk → users.id
  container_id  text
  started_at    integer
  ended_at      integer
  status        text  // 'running' | 'stopped' | 'error'
}

git_repos {
  user_id     text  // fk → users.id
  repo_path   text  // /var/vaults/<user_id>.git
  remote_url  text  // the URL the phone pushes to
}
```

---

## User Container (Dockerfile)

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

# Non-root user for sessions
RUN useradd -m -s /bin/bash claude
USER claude
WORKDIR /home/claude

# Vault mounted here at runtime
VOLUME /home/claude/vault
```

Resource limits applied at `docker run` time:
- `--memory=512m`
- `--cpus=0.5`
- `--pids-limit=100`
- `--network=claude-net` (custom bridge, no host access)

---

## Docker Compose Structure

### `docker-compose.dev.yml`
- SvelteKit dev server (port 3000)
- No Caddy (direct access)
- SQLite at `./data/dev.db`
- Vaults at `./data/dev-vaults/`

### `docker-compose.prod.yml`
- SvelteKit built (port 3001)
- Caddy on 80/443
- SQLite at `/var/data/prod.db`
- Vaults at `/var/vaults/`

---

## Deploy Script (`scripts/seed-admin.ts`)

```
Usage: npx tsx scripts/seed-admin.ts --email user@gmail.com
```

- Inserts a user row with the given Google email, role=admin, status=approved
- On next Google sign-in with that email, they get an admin session immediately
- They still go through Claude.ai OAuth link on first use

---

## Implementation Phases

### Phase 1 — Foundation
1. SvelteKit app scaffolding with Tailwind, PWA manifest, iOS meta tags
2. Drizzle schema + SQLite setup
3. Google OAuth login flow (callback, session cookie)
4. Middleware: route guards (pending users see only a waiting screen)
5. Deploy script: seed admin user
6. Docker Compose (dev)

### Phase 2 — Admin Panel
1. User list page (mobile card layout)
2. Approve/suspend user action
3. Basic session monitor (who is running, started when)

### Phase 3 — Claude.ai OAuth Link
1. OAuth flow for linking Claude.ai account
2. Encrypt and store tokens in `claude_credentials`
3. Token refresh logic
4. Settings page showing link status

### Phase 4 — Container + Session Manager
1. User container Dockerfile
2. `session-manager.ts`: spawn container, set up vault mount, inject Claude creds
3. WebSocket server: upgrade, route to session, bridge events
4. Container lifecycle: idle timeout, cleanup

### Phase 5 — Chat UI
1. Basic message list (streaming text)
2. Tool call cards
3. Permission prompt (approve/deny dialog)
4. Diff viewer (mobile unified diff)
5. `/command` input support
6. Session state indicator

### Phase 6 — Vault / Git
1. Bare repo creation per user on VPS
2. Git over HTTPS or SSH for phone sync
3. Container mounts user vault at session start
4. Settings page: configure remote URL / view push instructions

### Phase 7 — Production Hardening
1. `docker-compose.prod.yml` + Caddy config
2. Resource limits on containers
3. Network isolation
4. Secrets management (env vars, encryption key)
5. Basic monitoring page (admin only, mobile)

---

## Key Env Vars

```
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# Claude.ai OAuth
CLAUDE_OAUTH_CLIENT_ID=
CLAUDE_OAUTH_REDIRECT_URI=

# App
SESSION_SECRET=          # for signing session cookies
ENCRYPTION_KEY=          # for encrypting Claude tokens at rest
DATABASE_URL=            # path to SQLite file
VAULTS_DIR=              # directory for bare git repos

# Admin
ADMIN_EMAIL=             # used by seed script (can also pass as CLI arg)
```

---

## Decisions Still Open

- **Git auth for phone sync**: HTTPS (simpler, Caddy can proxy) vs SSH (more standard for
  Obsidian Git plugin). Recommend HTTPS with per-user tokens to start.
- **Claude.ai OAuth client ID**: Need to obtain this from Anthropic (or confirm the SDK
  handles the auth flow internally — the Claude Code CLI does this via a built-in browser
  redirect; need to verify if this can be replicated server-side for per-user credential
  storage).
