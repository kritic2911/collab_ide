# collab_ide Codebase Overview

This document provides a comprehensive, end-to-end technical overview of the collaborative IDE repository. It explains the system's architecture, database schema, authentication flow, Role-Based Access Control (RBAC), GitHub API integration, real-time WebSocket infrastructure, the in-file chat system, and the React frontend architecture.

## 1) High-Level Architecture

The repository is structured as a decoupled client-server architecture:

- **Backend (`server/`)**: A Node.js application built on the Fastify framework. It serves as the authoritative source for authentication (GitHub OAuth), session management, database persistence (PostgreSQL), GitHub API proxying, and real-time collaboration signaling via WebSockets.
- **Frontend (`client/`)**: A Single Page Application (SPA) built with React and Vite. It provides the user interface for authentication, an administrative portal for access control, a dashboard for users to access permitted repositories, and a collaborative code editor integrating the Monaco Editor.

There is a clear separation of concerns. The backend handles secrets and direct integration with GitHub and PostgreSQL, while the client state is managed via Zustand stores and queries the backend through protected REST and WebSocket APIs.

## 2) Repository Details & Routing Layout

### 2.1 Backend (`server/`)

- `src/index.ts`: The Fastify application entry point. It enforces strict environment variable validation, configures CORS, registers core plugins (session, passport, websockets), registers routing modules, and triggers database seed operations.
- `src/routes/`:
  - `auth.routes.ts`: Implements the core authentication loop. Exposes endpoints to verify the initial organization code (`POST /auth/verify-code`), initiate GitHub OAuth (`GET /auth/github`), handle the OAuth callback, and terminate sessions (`POST /auth/logout`).
  - `admin.routes.ts`: Restricted to `admin` users. Exposes REST endpoints to query the admin's personal GitHub repositories, connect them to the system, create and manage predefined/custom `roles` and `groups`, and configure which roles/groups have access to which connected repositories.
  - `repo.routes.ts`: Protected by general authentication. Exposes endpoints for standard users to fetch repositories they have RBAC permission to view (`GET /api/repos`). Also proxies requests to GitHub via the admin token to fetch branches, recursive file trees, and file content for specific repository IDs.
  - `github.routes.ts`: Designed to handle incoming GitHub webhooks (currently a stub awaiting implementation).
- `src/middleware/`:
  - `requireAuth.ts`: Verifies JSON Web Tokens (JWT) extracted from the `Authorization: Bearer <token>` header on protected routes.
  - `requireAdmin.ts`: Chained above `requireAuth`, enforcing that the decoded token's `role` property strictly equals `'admin'`.
- `src/plugins/`:
  - `session.plugin.ts`: Configures `@fastify/session` and `@fastify/cookie` to securely persist the OAuth handshake state.
  - `passport.plugin.ts`: Initializes Passport.js utilizing the `GitHubStrategy` defined in the auth module.
  - `wsPlugin.ts`: Intercepts connection upgrades to the `/ws` endpoint. It expects a `?token=` query parameter containing a valid JWT. If valid, the connection is upgraded, the decoded user context is bound to an `AuthenticatedSocket`, and it begins routing messages.
- `src/ws/`:
  - `roomManager.ts`: Maintains an in-memory `Map<string, Set<AuthenticatedSocket>>`. Provides methods to add/remove connections to deterministic room identifiers (e.g., `repoId:branch:filePath`) and broadcast messages to all peers in a room.
  - `messageHandler.ts`: A protocol router that parses incoming stringified JSON messages from clients (matching `ClientMessage` types) and invokes appropriate logic (`join_room`, `leave_room`, `diff_update`, `chat_message`, `chat_load_older`, `chat_delete`). Extends room join hydration to include the last 7 days of chat history.
  - `ws.types.ts`: Strictly types the WebSocket protocol payload surfaces between `ClientMessage` and `ServerMessage`. Includes `DiffPatch` schemas aligning to Monaco Editor `IModelContentChange`, as well as chat message types (`chat_message`, `chat_broadcast`, `chat_history`, `chat_older_history`, `chat_deleted`).
- `src/auth/`:
  - `jwt.ts`: Exports utilities to sign and cryptographically verify JWTs using the active `JWT_SECRET`. Encodes properties like `userId`, `username`, `role`, and `color`.
  - `crypto.ts`: Implements synchronous AES-256-CBC encryption to obscure sensitive values (like standard GitHub personal access tokens) in the database before storage using the `ENCRYPTION_KEY`.
  - `github.strategy.ts`: The core Passport OAuth strategy. It manages the post-GitHub validation handshake: evaluating if the user is the designated admin, verifying the organization code, creating or updating user entries in the database, and assigning predefined avatars/colors.
- `src/services/`:
  - `github.service.ts`: An abstraction over the `@octokit/rest` library. It exposes specific functionalities like fetching repositories, listing branches, obtaining a repository's recursive tree, and fetching blob file content via base64 decoding.
  - `token.service.ts`: Fetches and decrypts the encrypted GitHub tokens stored in the database.
  - `chatService.ts`: Encrypted chat persistence layer. Provides `saveMessage()` (encrypt→INSERT), `getHistory()` (SELECT→decrypt with 7-day window, max 50), `getOlderMessages()` (cursor-based pagination up to 30 days), and `deleteMessage()` (ownership-verified DELETE). Reuses the AES-256-CBC `encrypt()`/`decrypt()` from `auth/crypto.ts`.
- `src/db/`:
  - `client.ts`: Constructs the `pg.Pool` connection resolving against `DATABASE_URL`.
  - `seedOrgCode.ts` & `seedRoles.ts` & `seedUsers.ts`: Bootstrapping utilities to auto-configure table presets based on the current `.env`.
  - `migrations/`:
    - `001_init.sql`: Base structures establishing `users` and `organizations`.
    - `002_admin_portal.sql`: The advanced RBAC schemas introducing `groups`, `roles`, and relational mappings for repository visibility.
    - `005_chat.sql`: The `chat_messages` table with denormalized `username`/`avatar_url`, an encrypted `message_enc` column (AES-256-CBC `iv:ciphertextHex`), foreign key to `users(id)` with `ON DELETE CASCADE`, and composite indexes on `(room_id, created_at DESC)` and `(user_id)`.

### 2.2 Frontend (`client/`)

- `src/main.tsx` & `src/App.tsx`: App configuration injecting the React Router DOM logic defining core application URLs and protecting specific routes behind `<RequireAuth>` and `<RequireAdmin>` wrapper components.
- `src/pages/`:
  - `Login.tsx`: The primary interaction surface capturing the organizational code before routing the user into OAuth via `window.location`.
  - `AuthCallback.tsx`: A silent rendering component intercepting the OAuth redirect callback, plucking the `token` from the URL parameters, writing it to `localStorage`, and cleanly rerouting to the dashboard.
  - `AdminDashboard.tsx`: A complex administrative view. Divided into three major domains: Connecting personal GitHub repositories to the IDE system; managing arbitrary Roles and Groups bridging specific Users; and configuring granular Repository Access restrictions using multi-select interfaces linked directly to the Role/Group identifiers in the database.
  - `Dashboard.tsx`: The standard user entry point invoking `/api/repos` to formulate a grid of accessible repositories allowing the user to initiate a browsing session.
  - `RepoBrowser.tsx`: A comprehensive layout mirroring standard IDE workflows. Features a recursive DOM representation (`TreeView`) of a selected branch's file tree and dynamically implements an embedded read-only `@monaco-editor/react` interface based on active file selections.
  - `IDE.tsx`: The collaborative editing page. Renders a 3-column grid layout (`280px 1fr 260px`) hosting the file tree, the collaborative Monaco editor with presence indicators, and the webhook log. Integrates the collapsible `ChatPanel` as a right-edge overlay within the editor column. Clears chat state on file switch.
- `src/api/`:
  - `client.ts`: Exposes a robust `axios` instance heavily integrated with interceptors appending the `collabide_jwt` authorization header to all outbound payloads transparently.
  - `admin.ts`: A centralized repository of specific async functions communicating heavily typed payloads to the variety of backend API endpoints.
- `src/store/`:
  - `repoStore.ts`: A Zustand global store retaining the current state of selected repositories, fetched github trees, and branch data decoupled from specific unmount phases of React functional components.
  - `fileStore.ts`: Tracks open file paths, active branches, and retains mappings of string payloads caching open file contents across views.
  - `collabStore.ts`: Manages real-time collaboration state including peers, diff patches, and peer document content maps.
  - `chatStore.ts`: Zustand store for the chat panel. Manages the message list (deduped by PG serial id), panel open/closed state, unread badge count, `hasOlderMessages`/`loadingOlder` pagination tracking. Actions include `setHistory`, `addMessage`, `prependMessages`, `removeMessage`, `toggleOpen`, and `clear`.
- `src/hooks/useAuth.ts`: Encapsulates operations against `localStorage` mapping token fetching, simple client-side JWT sub-parsing (ignoring signatures), and establishing clear `isLoggedIn` boolean abstractions routines.
- `src/components/`:
  - `ChatPanel.tsx`: A collapsible right-edge overlay chat panel. Collapsed state renders a floating 💬 button with an unread badge count. Expanded state renders a 320px glassmorphism panel with: a "↑ Load older messages" pagination button at the top, date separators between messages from different days, user avatars with `colorFromUsername()` color coding, hover-to-reveal 🗑 delete button on own messages, auto-scroll with scroll-lock detection, and a textarea input with Enter-to-send / Shift+Enter for newlines.

## 3) Core Sub-systems Documentation

### 3.1 Authentication & The Entry Gate

The entry protocol ensures no external user can enter without first knowing a specific organizational pass phrase. The flow executes as follows:
1. The user inputs their org code in `Login.tsx`, hitting `POST /auth/verify-code`.
2. The server bcrypt compares this code against the lone entry in the `organizations` table.
3. If validated, the client unlocks the "Login with GitHub" function pointing local routing to `GET /auth/github?orgCode=<encoded>`.
4. Passport intercepts this URL, injects the `orgCode` into a verified `state` object, and redirects the user externally to GitHub's OAuth systems.
5. Post-authorization, GitHub redirects to `GET /auth/github/callback`. The internal Passport strategy reconstructs the `state`, re-validates the `orgCode`, accesses the GitHub user profile, and processes the database insertion.
6. A JWT is securely signed including the internal numeric database `userId` and returned to the client as a URL parameter for `localStorage` persistence.

### 3.2 Role-Based Access Control (RBAC) 

The system implements a flexible RBAC network allowing fine-grained control over specific connected repositories.
- Repositories in the `connected_repos` table hold a `visibility` field defining access as either `'all'` (public to any authenticated user) or `'restricted'`.
- Restricted repositories rely on evaluating intersection rules built mapped in the `repo_access` table referencing `roles` and `groups`.
- Within the `repo.routes.ts` module, the `canAccess(userId, repoId)` helper explicitly queries whether a standard user operates under a `role` mapping (via `user_roles`) or a `group` mapping (via `user_groups`) that overlaps with the target connection configuration in `repo_access`.

### 3.3 Proxying GitHub API Interactions

The architecture avoids demanding Personal Access Tokens from normal users.
1. An administrator initializes the app (flagged automatically based on the `ADMIN_GITHUB_USERNAME` environment variable).
2. The Passport strategy intercepts the administrator's GitHub OAuth token during login, securely encrypting it utilizing AES-256-CBC, and locking it in the `users.github_token` column.
3. When standard users interact with specific connected repositories (e.g. attempting to read a file or traverse branches), the application decrypts the administrator's hidden token and processes operations against the Octokit API on the user's behalf.
4. Effectively making the CollabIDE system behave natively as the administrative user when polling target GitHub endpoints ensuring the original system retains total internal security isolation.

### 3.4 WebSockets & Collaborative Infrastructure

A sophisticated real-time signaling backbone is implemented directly parallel to HTTP routing.
- Fastify routes upgraded connections leveraging the `@fastify/websocket` protocols.
- To prevent public socket monitoring, JWT evaluations occur actively during the upgrade handshake dynamically parsing URL query strings allowing valid handshakes exclusively.
- Upon valid execution, structural logic dynamically assigns `peers` (sockets) into discrete mathematical boundaries mapped against unique `roomId` expressions built from combining `repoId:branch:filePath`.
- Operational logic acts aggressively on disconnection patterns routing active `peer_left` updates consistently updating structural models and tracking open active populations correctly utilizing the `messageHandler.ts` utilities natively.

### 3.5 In-File Chat System

A persistent, encrypted, real-time chat system scoped to file-level collaboration rooms.

**Architecture:**
- Chat messages flow through the **existing WebSocket connection** — no new endpoints or connections.
- Messages are **encrypted at rest** in PostgreSQL using AES-256-CBC (`auth/crypto.ts`) with the same `ENCRYPTION_KEY` that protects GitHub tokens. The `message_enc` column stores only `iv:ciphertextHex`. Decryption happens server-side before sending to clients.
- Real-time delivery uses the **existing Redis Pub/Sub** infrastructure. The server persists to PG first, then publishes plaintext through PubSub for fan-out. Redis never stores chat data.
- Each chat thread is scoped to a **room** (`repoId:branch:filePath`), matching the collaboration room model.

**Data lifecycle:**
1. **On room join**: Server fetches the last 7 days of messages (max 50) from PG, decrypts, and sends as `chat_history`.
2. **On send**: Client sends `chat_message` → Server validates (1-2000 chars) → encrypts → `INSERT` → PubSub `publish` → all peers receive `chat_broadcast`.
3. **Pagination**: Client sends `chat_load_older` with `beforeId` cursor → Server fetches up to 30 older messages (capped at 30 days) → responds with `chat_older_history` + `hasMore` flag.
4. **Delete**: Client sends `chat_delete` with `messageId` → Server verifies ownership (`WHERE id = $1 AND user_id = $2`) → deletes → PubSub broadcasts `chat_deleted` to all peers.
5. **Cleanup**: A `setInterval` in `index.ts` runs every 24 hours: `DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'`.

**Security model:**
- Messages are encrypted at rest (not end-to-end — the server decrypts before relaying).
- Only the message owner can delete their messages (server-enforced via `user_id` check).
- All chat operations require an authenticated WebSocket connection (JWT verified during upgrade handshake).

## 4) Structural Ambiguities & Future Milestones

While substantial administrative, access controlling, routing hierarchies, and real-time chat exist securely mapping internal operations smoothly the structure remains technically incomplete around specific milestones:

- **Monaco CRDT / Operational Transformation Integration:** The socket layers accurately parse and broadcast raw `diff_update` patterns to mapped active presence rooms, but the frontend lacks correct Operational Transform (OT) or CRDT bindings on the `@monaco-editor/react` components to physically apply sequential patch modifications overlapping concurrently without explicit disruption sequences occurring rapidly.
- **GitHub Webhook Syncs:** The system evaluates GitHub structures statically based on polling requests when paths are actively clicked traversing the `TreeView` inside the `RepoBrowser`. It lacks dynamic asynchronous web hooks pushing explicit `remote_push` mechanisms notifying logged users if targeted code trees are modified natively across external GitHub operations.
- **Save Operations:** Write-back commands mapping modified internal abstractions correctly to Octokit Commit APIs appending explicit data successfully against targeted active branches are lacking direct bindings.
