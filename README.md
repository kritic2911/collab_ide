# collab_ide

## Tech Stack
| Layer | Use | Why| 
|---|---|---|
|Backend|Node.js + Fastify| Fast, WebSocket-friendly, everyone knows JS|
| WebSockets |ws library or Fastify's built-in | Simple, no overhead |
|Frontend| React| Component model suits editor UI|
|Code Editor|Monaco Editor (React wrapper)|This is VS Code's editor — don't build your own, it handles diff views natively|
|Database|PostgreSQL only|Need to handle only user profiles, connected repos, chat messages|
|In-memory state|Plain JS Maps|Replaces Redis for MVP|
|Auth|GitHub OAuth via Passport.js|Gives you user identity + repo access in one flow|
|Collaboration UI| Zustand + React Hooks | Native WebSocket, presence dots, and Monaco line-level peer highlighting with hover-diff summaries|

## Database
### Basic tables needed
**users:**
>  `id, github_id, username, avatar_url, 
  color_hex, github_token (encrypted), created_at`

**repositories:**
>  `id, github_repo_id, owner_id, name, 
  full_name, webhook_id, created_at`

**chat_messages:**
> `id, repo_id, branch, filepath, 
  author_id, content, line_pin_start, 
  line_pin_end, created_at`

## Starting Structure
```
.
├── CHANGELOG.md
├── client
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── src
│   │   ├── api
│   │   │   ├── admin.ts
│   │   │   ├── client.ts
│   │   │   └── repo.ts
│   │   ├── App.tsx
│   │   ├── components
│   │   │   ├── BranchSelector.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── CollabEditor.tsx
│   │   │   ├── Editor.tsx
│   │   │   ├── FileTree.tsx
│   │   │   ├── PeerDiffGutter.tsx
│   │   │   ├── PeerDiffWindow.tsx
│   │   │   ├── PresenceBar.tsx
│   │   │   └── WebhookLog.tsx
│   │   ├── hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useCollabSocket.ts
│   │   │   ├── useRoom.ts
│   │   │   └── useWebSocket.ts
│   │   ├── lib
│   │   │   └── wsUrl.ts
│   │   ├── main.tsx
│   │   ├── pages
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── AuthCallback.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── IDE.tsx
│   │   │   ├── InvalidCode.tsx
│   │   │   ├── Login.tsx
│   │   │   └── RepoBrowser.tsx
│   │   ├── store
│   │   │   ├── chatStore.ts
│   │   │   ├── collabStore.ts
│   │   │   ├── fileStore.ts
│   │   │   └── repoStore.ts
│   │   ├── ui
│   │   │   ├── Shell.tsx
│   │   │   └── styles.ts
│   │   └── vite-env.d.ts
│   ├── tsconfig.json
│   └── vite.config.ts
├── CODEBASE_OVERVIEW.md
├── docker-compose.yml
├── implementation_plan.md
├── implementation_plan_diff.md
├── package-lock.json
├── README.md
├── server
│   ├── package-lock.json
│   ├── package.json
│   ├── server.log
│   ├── src
│   │   ├── auth
│   │   │   ├── crypto.ts
│   │   │   ├── github.strategy.ts
│   │   │   └── jwt.ts
│   │   ├── cache
│   │   │   └── branchCache.ts
│   │   ├── db
│   │   │   ├── client.ts
│   │   │   ├── migrations
│   │   │   │   ├── 001_init.sql
│   │   │   │   ├── 002_admin_portal.sql
│   │   │   │   ├── 003_webhooks.sql
│   │   │   │   ├── 004_add_webhook_id.sql
│   │   │   │   └── 005_chat.sql
│   │   │   ├── seedOrgCode.ts
│   │   │   ├── seedRoles.ts
│   │   │   └── seedUsers.ts
│   │   ├── index.ts
│   │   ├── middleware
│   │   │   ├── requireAdmin.ts
│   │   │   └── requireAuth.ts
│   │   ├── plugins
│   │   │   ├── passport.plugin.ts
│   │   │   ├── session.plugin.ts
│   │   │   ├── wh.plugin.ts
│   │   │   ├── ws.plugin.ts
│   │   │   └── wsPlugin.ts
│   │   ├── routes
│   │   │   ├── admin.routes.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── github.routes.ts
│   │   │   ├── repo.routes.ts
│   │   │   └── webhook.routes.ts
│   │   ├── services
│   │   │   ├── chatService.ts
│   │   │   ├── github.service.ts
│   │   │   └── token.service.ts
│   │   ├── state
│   │   │   ├── baseCache.ts
│   │   │   ├── cacheManager.ts
│   │   │   ├── diffStore.ts
│   │   │   ├── lru.ts
│   │   │   ├── presenceStore.ts
│   │   │   ├── pubsub.ts
│   │   │   └── redis.client.ts
│   │   ├── utils
│   │   │   └── fileLogger.ts
│   │   └── ws
│   │       ├── messageHandler.ts
│   │       ├── roomManager.ts
│   │       └── ws.types.ts
│   ├── tsconfig.json
│   ├── webhooks.log
│   └── WEBHOOKS.md
├── task.md
├── tree.txt
├── walkthrough.md
└── webhooks_implementation.md

``` 

## Local setup (quick)

### Postgres: fixing “password authentication failed”

The server connects using `server/.env` → `DATABASE_URL`.

- If you are using **local Postgres (Windows service)**, update `server/.env` so the password matches your local `postgres` user password.
- If you intended to use **Docker**, you’ll need Docker installed and available in PATH; otherwise the `docker-compose.yml` file won’t run.

If you previously created the DB/user with a different password, either:

- **Change the URL to the correct password** in `server/.env`, or
- **Reset the `postgres` password** (example):

```sql
ALTER USER postgres WITH PASSWORD 'password';
```

Then restart the server.

### Postgres via Docker (recommended for shared dev)

This repo already includes `docker-compose.yml` for Postgres.

- **Install Docker Desktop** (Windows) and make sure `docker` works in a new terminal (`docker --version`).
- **Start Postgres** (from repo root):

```bash
docker compose up -d db
```

- **Use the shared DB URL** in `server/.env` (or copy `server/.env.docker.example` → `server/.env`):

`DATABASE_URL=postgresql://postgres:password@localhost:5432/collabide`

- **If you ever change `POSTGRES_PASSWORD`** in `docker-compose.yml`, you must reset the volume (otherwise the old password stays):

```bash
docker compose down -v
docker compose up -d db
```

#### Running the migration against the Docker DB

From repo root (runs `psql` inside the container):

```bash
docker compose exec -T db psql -U postgres -d collabide -f /dev/stdin < server/src/db/migrations/002_admin_portal.sql
```

### Client env

Create `client/.env` from `client/.env.example` and keep:

- `VITE_API_URL=http://localhost:3000`

### GitHub Webhooks (Local Dev & Team Setup)

For the Live Awareness and push notifications to function, CollabIDE must receive real-time webhooks from GitHub. Because GitHub cannot reach your local `localhost:3000`, **each developer must use Ngrok and their own unique webhook configuration**.

Please read the detailed walkthrough and architecture guide located in [webhooks_implementation.md](./webhooks_implementation.md). It outlines:
1. How to start your Ngrok tunnel
2. Setting your unique `GITHUB_WEBHOOK_SECRET`
3. Configuring a personal Webhook on the shared GitHub repository so that you do not break your teammates' environments.

## Pipeline Modifications & State Layer

### New Modules
This integration refactors the state layer entirely via `server/src/state/`:
- `cacheManager.ts`: Master orchestration for L1 -> L2 -> L3 base content retrieval.
- `diffStore.ts`: Redis JSON array patch manager providing temporary rolling diff snapshots per user.
- `lru.ts`: High-performance manual LRU implementation serving as L1.
- `presenceStore.ts`: Redis sets manager tracking room participants idempodently.
- `pubsub.ts`: Multi-node redis subscription manager for realtime cross-process event relaying.
- `redis.client.ts`: Provides connection lifecycles for both master mapping and PubSub mechanisms.

### New Environment Variables
- `REDIS_URL` (Optional): The connection string URL for the Redis server. Defaults to `redis://localhost:6379`.
