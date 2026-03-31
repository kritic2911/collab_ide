# collab_ide Codebase Overview

This document explains what the repository currently does end-to-end: how the backend authenticates users (GitHub OAuth gated by an organization code), how the frontend performs the login flow and stores the resulting JWT, and what parts are currently stubbed/unfinished.

## 1) High-level architecture

The repo is a simple two-part system:

- `server/` (Node.js + Fastify): Handles GitHub OAuth using Passport, validates an organization code, stores users in PostgreSQL, and issues/verifies JWTs.
- `client/` (React + Vite): Provides a login UI, triggers the OAuth flow, receives the issued JWT, stores it in `localStorage`, and routes the user to a placeholder “dashboard”.

There is no working “collaborative editor” implementation yet in the checked-in code; the editor-related pages/components exist as empty (0-byte) files.

## 2) Repository layout

- `server/`
  - `src/index.ts`: Fastify app bootstrap (env validation, CORS, plugins, routes, health check)
  - `src/routes/auth.routes.ts`: The only implemented server routes (org code verification, OAuth start/callback, logout)
  - `src/plugins/session.plugin.ts`: Fastify session + cookie setup
  - `src/plugins/passport.plugin.ts`: Passport initialization + GitHub strategy wiring
  - `src/auth/*`: JWT signing/verification and AES encryption for GitHub tokens
  - `src/services/github.service.ts`: GitHub API wrappers (token-based) — currently not used by any implemented route
  - `src/services/token.service.ts`: DB helpers to get/set encrypted GitHub tokens — currently not used by any implemented route
  - `src/db/*`: PostgreSQL connection wrapper and startup org-code seeding
  - `src/db/migrations/001_init.sql`: SQL tables for `users` and `organizations`
  - `src/routes/github.routes.ts` and `src/routes/repo.routes.ts`: Empty (0-byte) in this repo state
- `client/`
  - `src/main.tsx`: React entry + `BrowserRouter`
  - `src/App.tsx`: React Router routes (login, auth callback, invalid code, dashboard placeholder)
  - `src/pages/Login.tsx`: Organization code input + OAuth trigger
  - `src/pages/AuthCallback.tsx`: Stores the JWT and navigates onward
  - `src/pages/InvalidCode.tsx`: Simple “wrong code” screen
  - `src/hooks/useAuth.ts`: Token storage, decoding helper, logout
  - `src/api/client.ts`: Axios instance intended to attach `Authorization: Bearer <token>` (currently inconsistent with `useAuth.ts`)
  - `src/store/fileStore.ts`: Zustand store for file contents (currently not used by any non-empty editor UI)
  - `src/pages/Dashboard.tsx`, `src/pages/IDE.tsx`, and editor components in `src/components/*`: Empty (0-byte) in this repo state
- `docker-compose.yml`: Local Postgres service for development
- `README.md`: High-level planned structure; however, parts of that plan are not implemented in the current code state.

## 3) Backend (`server/`)

### 3.1 Runtime + startup flow

Entry point: `server/src/index.ts`.

On startup it does the following:

1. Loads env vars via `dotenv/config`.
2. Validates required environment variables and terminates if any are missing:
   - `DATABASE_URL`
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `JWT_SECRET`
   - `ENCRYPTION_KEY`
   - `ADMIN_GITHUB_USERNAME`
   - `ORG_CODE`
3. Creates a Fastify app with logging enabled.
4. Registers CORS:
   - `origin` defaults to `process.env.CLIENT_URL` or `http://localhost:5173`
   - `credentials: true`
5. Registers plugins in order:
   - `sessionPlugin` first (cookie + session configuration)
   - `passportPlugin` second (Passport initialize + strategy registration)
6. Registers only `authRoutes` (no other route modules are registered because they are empty).
7. Calls `seedOrgCode()` to ensure the organization-code hash exists in the DB.
8. Exposes `GET /health` returning `{ status: 'ok' }`.
9. Listens on `PORT` (default `3000`) at `host: 0.0.0.0`.

### 3.2 Database layer (`src/db/*`)

- `src/db/client.ts`
  - Creates a singleton `pg.Pool` using `DATABASE_URL`.
  - Tests DB connectivity on startup (`SELECT 1`); the process exits if the DB is unreachable.
  - Exports a `db.query(...)` helper for other modules.

- `src/db/migrations/001_init.sql`
  - `users` table:
    - `id` (SERIAL primary key)
    - `github_id` unique
    - `username`, `avatar_url`, `color_hex`
    - `role` (`admin` or `user`)
    - `github_token` (AES-encrypted; used only for admin users)
  - `organizations` table:
    - stores a single `code_hash` (bcrypt hash of the org code)

- `src/db/seedOrgCode.ts`
  - Uses `ORG_CODE` from env.
  - If no row exists in `organizations`, it bcrypt-hashes `ORG_CODE` and inserts a new row.
  - If a row already exists, it updates the stored hash to match the current `ORG_CODE`.

### 3.3 Auth and security primitives

#### JWT (`src/auth/jwt.ts`)

- `signJwt(payload)` signs a JWT using:
  - secret: `JWT_SECRET`
  - expiration: `JWT_EXPIRES_IN` (default `7d`)
- `verifyJwt(token)` verifies and returns a typed payload, returning `null` instead of throwing.

The JWT payload type includes:

- `userId` (number)
- `username` (string)
- `role` (`admin` | `user`)
- `color` (string)
- `avatarUrl` (string)

#### AES encryption for GitHub tokens (`src/auth/crypto.ts`)

- Uses AES-256-CBC with:
  - algorithm: `aes-256-cbc`
  - key derived from `ENCRYPTION_KEY`
- On module load it validates `ENCRYPTION_KEY` is exactly 32 characters (it uses `Buffer.from(rawKey, 'utf8')`).
- `encrypt(plaintext)` produces a string formatted as: `ivHex:ciphertextHex`
- `decrypt(ciphertext)` reverses that format.

Important implication: because the code assumes a 32-character UTF-8 string maps cleanly to 32 bytes, keys with non-ASCII characters could produce unexpected byte lengths.

### 3.4 GitHub OAuth gating + user provisioning (`src/plugins/*` + `src/auth/*`)

OAuth routing is implemented in `src/routes/auth.routes.ts` and Passport wiring happens in `src/plugins/passport.plugin.ts` + `src/auth/github.strategy.ts`.

#### `sessionPlugin` (`src/plugins/session.plugin.ts`)

- Registers:
  - `@fastify/cookie`
  - `@fastify/session`
- Uses `JWT_SECRET` as the session secret (so the JWT secret also signs the session cookie).

Sessions are used to complete Passport’s OAuth handshake; issued JWTs are what the client stores and sends later.

#### `passportPlugin` (`src/plugins/passport.plugin.ts`)

- Initializes Passport.
- Registers Passport’s GitHub strategy (`githubStrategy` from `src/auth/github.strategy.ts`).
- Passport serializer stores only `user.id` in the session.
- Passport deserializer fetches the full user row from `users` table by `id`.

#### `githubStrategy` (`src/auth/github.strategy.ts`)

This strategy performs several checks/actions:

1. Determines whether the GitHub profile username matches `ADMIN_GITHUB_USERNAME`.
2. For non-admin users, it validates an organization code:
   - The `/auth/github` route passes `orgCode` into OAuth `state` as JSON: `{ orgCode: <value> }`
   - On callback, the strategy parses `req.query.state`, extracts `orgCode`, and calls `verifyOrgCode(orgCode)`
   - `verifyOrgCode` compares against the stored bcrypt hash in `organizations`
   - If invalid/missing, it fails authentication with `{ message: 'invalid_code' }`
3. It assigns a `role`:
   - `admin` for admins
   - `user` for non-admins
4. It upserts the user into `users`:
   - If the `github_id` is new:
     - assigns a deterministic color chosen by round-robin count (`pickColor()`)
     - stores an encrypted GitHub access token only for admins (`encrypt(accessToken)`), otherwise `github_token = null`
   - If the user exists:
     - updates username + avatar, and updates encrypted token only for admins (COALESCE keeps existing token if a user is re-authorized as non-admin)

### 3.5 Server routes (`src/routes/auth.routes.ts`)

This file contains all implemented backend endpoints in the current repo state.

1. `POST /auth/verify-code`
   - Request body: `{ orgCode?: string }`
   - Validates `orgCode` presence, then calls `verifyOrgCode(orgCode)`
   - Response: `{ valid: true }` or `{ valid: false, message?: ... }` with HTTP 400 for missing input
   - Used by the frontend to prevent sending users into OAuth for obviously invalid codes.

2. `GET /auth/github`
   - Query param: `orgCode`
   - Builds a JSON `state` payload containing the org code and starts Passport GitHub OAuth:
     - scope: `read:user`

3. `GET /auth/github/callback`
   - Passport handles success/failure.
   - On success, it:
     - reads the authenticated user from `req.user`
     - signs a JWT with the user fields (`userId`, `username`, `role`, `color`, `avatarUrl`)
     - redirects back to the frontend at:
       - `${CLIENT_URL}/auth/callback?token=${token}`
   - On failure, it redirects to:
     - `${CLIENT_URL}/invalid-code`

4. `POST /auth/logout`
   - `preHandler: requireAuth`
   - It attempts to destroy the session (`req.session?.destroy()`).
   - Returns `{ success: true }`

5. `GET /health`
   - Returns `{ status: 'ok' }`

#### JWT authentication middleware (`src/middleware/requireAuth.ts`)

- Expects `Authorization: Bearer <token>`.
- Uses `verifyJwt(token)` to decode and validate.
- Attaches the decoded payload to `req.user`.
- Returns `401` if:
  - the Authorization header is missing/malformed
  - JWT verification fails/expired

### 3.6 GitHub API + token services (currently unused)

- `src/services/github.service.ts`
  - Wraps `@octokit/rest` to list user repos, list branches, and fetch a recursive Git tree and file contents.
  - These functions are not wired to any implemented route in the current repo state (because `github.routes.ts` and `repo.routes.ts` are empty).

- `src/services/token.service.ts`
  - `getGithubToken(userId)` reads encrypted token from DB and decrypts it.
  - `setGithubToken(userId, plainToken)` encrypts and stores it.
  - These are also not currently used by any route.

## 4) Frontend (`client/`)

### 4.1 Build/dev tooling

- Vite + React entry uses `client/vite.config.ts`.
- Client scripts (from `client/package.json`):
  - `npm run dev`: `vite`
  - `npm run build`: `vite build`
  - `npm run preview`: `vite preview`
- `client/index.html` loads `/src/main.tsx`.

### 4.2 Client routing (`src/App.tsx`)

Routes currently implemented:

- `/login` → `Login` page
- `/auth/callback` → `AuthCallback` page
- `/invalid-code` → `InvalidCode` page
- `/dashboard` → placeholder `Dashboard (coming soon)` (actual `Dashboard.tsx` file is empty in this repo state)
- `*` (catch-all) → redirects to `/login`

### 4.3 OAuth + JWT storage flow

#### Login page (`src/pages/Login.tsx`)

1. Renders an “Organization Code” input (password field).
2. User clicks “Verify Code”:
   - Calls `POST http://localhost:3000/auth/verify-code`
   - Body: `{ orgCode: <typed code> }`
   - If valid, updates UI state to enable “Login with GitHub”
3. User clicks “Login with GitHub”:
   - Navigates to:
     - `http://localhost:3000/auth/github?orgCode=<encoded>`

If `Login.tsx` sees query param `error=auth_failed`, it displays an error message. (The server currently redirects to `/login?error=auth_failed` on callback exceptions.)

#### Auth callback page (`src/pages/AuthCallback.tsx` + `src/hooks/useAuth.ts`)

- `AuthCallback` calls `useAuthCallback()`.
- `useAuthCallback`:
  1. Reads `token` from `window.location.search` (query param).
  2. If present:
     - stores token in `localStorage` under `collabide_jwt`
     - removes the `?token=...` part from the URL using `window.history.replaceState`
     - navigates to `/dashboard`
  3. If missing:
     - navigates to `/login`

### 4.4 Token helpers (`src/hooks/useAuth.ts`)

- `getToken()` returns `localStorage.getItem('collabide_jwt')`.
- `isLoggedIn()` returns whether that key exists.
- `getUser()` decodes the JWT payload on the client by:
  - base64-decoding the middle part of the JWT
  - parsing JSON
  - mapping fields into the `JwtPayload` shape
  - Note: it does not verify signature/expiry client-side.
- `logout()`:
  - removes `collabide_jwt` from localStorage
  - calls `POST http://localhost:3000/auth/logout` with `Authorization: Bearer <token>` if it had a token
  - redirects to `/login`

### 4.5 API client + inconsistency note (`src/api/client.ts`)

`src/api/client.ts` creates an Axios instance with:

- `baseURL: import.meta.env.VITE_API_URL`
- request interceptor that attaches:
  - `Authorization: Bearer ${localStorage.getItem('jwt')}`

However, the rest of the code stores the token under `collabide_jwt`, not `jwt`.

So, as currently written:

- Axios requests may attach `Authorization: Bearer null` (depending on how/if `jwt` is set elsewhere).
- `VITE_API_URL` is not defined in the checked-in Vite config, so `baseURL` may be `undefined` unless provided via environment variables.

No non-empty code currently uses this Axios instance (because the editor/dashboard pages are empty).

### 4.6 Editor/file state (`src/store/fileStore.ts`)

`fileStore.ts` defines a Zustand store:

- `openFiles: Map<string, string>` mapping `filePath -> raw content`
- `activePath: string | null`
- `activeBranch: string | null`
- Actions:
  - `setFileContent(path, content)` stores content and sets the file as active
  - `setActivePath(path)` sets active file path
  - `setActiveBranch(branch)` clears open files and resets active path

In the current repo state, none of the editor UI components that would use this store contain implementation code (they are empty).

## 5) Docker / local development (`docker-compose.yml`)

`docker-compose.yml` spins up:

- Postgres container (`postgres:16-alpine`)
  - database: `collabide`
  - user: `postgres`
  - password: `password`
  - port mapping: `5432:5432`
  - volume: `pgdata:/var/lib/postgresql/data`

The server expects `DATABASE_URL` matching that configuration (see `server/.env`).

## 6) Environment variable expectations

### Server

`server/src/index.ts` terminates on startup if any of these are missing:

- `DATABASE_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `JWT_SECRET`
- `ENCRYPTION_KEY` (must be exactly 32 characters as implemented)
- `ADMIN_GITHUB_USERNAME`
- `ORG_CODE`

Server also uses:

- `CLIENT_URL` (for CORS + OAuth redirects; defaults to `http://localhost:5173`)
- `PORT` (defaults to 3000)

### Client

Vite config is minimal (`server.port = 5173`) and does not define `VITE_API_URL`.

The current `Login.tsx` does not use `VITE_API_URL`; it hardcodes `http://localhost:3000` for server calls.

## 7) Important “current state” mismatches / stubs

The repository contains several files referenced by `README.md` and/or implied by the planned architecture, but they are empty (0-byte) in the current checked-in state:

- Backend:
  - `server/src/routes/github.routes.ts` is empty
  - `server/src/routes/repo.routes.ts` is empty
- Frontend:
  - `client/src/pages/Dashboard.tsx` is empty (but `App.tsx` currently uses a simple placeholder element instead)
  - `client/src/pages/IDE.tsx` is empty
  - `client/src/components/FileTree.tsx` is empty
  - `client/src/components/BranchSelector.tsx` is empty
  - `client/src/components/Editor.tsx` is empty

So the working part of the app right now is primarily:

- org code verification (`POST /auth/verify-code`)
- GitHub OAuth (`/auth/github` + `/auth/github/callback`)
- JWT issuance + client storage
- logout

Everything related to repo browsing, branches, file tree, and Monaco editing is not implemented yet in this repo state, even though GitHub API and Zustand store scaffolding exist.

