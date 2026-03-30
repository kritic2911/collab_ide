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
collab-ide/
├── server/
│   ├── src/
│   │   ├── auth/
│   │   │   ├── github.strategy.ts     # passport-github2 strategy config
│   │   │   ├── jwt.ts                 # sign / verify JWTs (jsonwebtoken)
│   │   │   └── crypto.ts              # AES-256 encrypt/decrypt for GitHub token
│   │   ├── db/
│   │   │   ├── client.ts              # pg Pool singleton
│   │   │   └── migrations/
│   │   │       └── 001_init.sql       # users + connected_repos tables
│   │   ├── routes/
│   │   │   ├── auth.routes.ts         # GET /auth/github  GET /auth/github/callback  POST /auth/logout
│   │   │   ├── repo.routes.ts         # POST /api/repos   GET /api/repos
│   │   │   └── github.routes.ts       # GET /api/github/branches  /tree  /file
│   │   ├── services/
│   │   │   ├── github.service.ts      # Octokit wrapper — all GitHub API calls live here
│   │   │   └── token.service.ts       # get/set encrypted token from DB for a userId
│   │   ├── middleware/
│   │   │   └── requireAuth.ts         # Fastify preHandler — verifies JWT, attaches req.user
│   │   ├── plugins/
│   │   │   ├── passport.plugin.ts     # registers @fastify/passport
│   │   │   └── session.plugin.ts      # registers @fastify/session (needed by passport)
│   │   └── index.ts                   # app entry — registers plugins + routes, starts server
│   ├── .env                           # PORT, DATABASE_URL, GITHUB_CLIENT_ID/SECRET, JWT_SECRET, ENCRYPTION_KEY
│   ├── tsconfig.json
│   └── package.json
│
├── client/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts              # axios instance — attaches JWT from localStorage on every request
│   │   ├── components/
│   │   │   ├── FileTree.tsx            # recursive tree, handles files + folders, click → open file
│   │   │   ├── BranchSelector.tsx      # controlled <select> of branches
│   │   │   └── Editor.tsx              # Monaco wrapper — reads from fileStore, read-only for now
│   │   ├── pages/
│   │   │   ├── Login.tsx              # single button → window.location = server /auth/github
│   │   │   ├── Dashboard.tsx          # repo URL input + list of connected repos
│   │   │   └── IDE.tsx                # layout: sidebar (BranchSelector + FileTree) | Editor
│   │   ├── store/
│   │   │   └── fileStore.ts           # Zustand — Map<filePath, content>, activePath, activeBranch
│   │   ├── hooks/
│   │   │   └── useAuth.ts             # reads JWT from URL param on OAuth return, stores it, redirects
│   │   ├── App.tsx                    # React Router routes: /login  /dashboard  /ide/:owner/:repo
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── docker-compose.yml                 # postgres service only for local dev
└── .gitignore
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

### Webhooks & Local Development

For GitHub webhooks to reach your local environment, GitHub cannot reach `localhost` directly.
1. Install and run `ngrok http 3001` to create a public tunnel.
2. Set `WEBHOOK_TARGET_URL=https://<your-ngrok-id>.ngrok-free.app/webhooks/github` in `server/.env`.
3. Set `GITHUB_WEBHOOK_SECRET=your-secure-secret` in `server/.env`.
4. When adding a repository via the backend API, it will automatically register this webhook URL using these environment variables. Teammates must do this or the webhooks won't fire locally.