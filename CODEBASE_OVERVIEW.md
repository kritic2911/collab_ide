# collab_ide Codebase Overview

This document provides a comprehensive, end-to-end technical overview of the collaborative IDE repository. It explains the system's architecture, database schema, authentication flow, Role-Based Access Control (RBAC), GitHub API integration, real-time WebSocket infrastructure, peer document viewing, and the React frontend architecture.

## 1) High-Level Architecture

The repository is structured as a decoupled client-server architecture:

- **Backend (`server/`)**: A Node.js application built on the Fastify framework. It serves as the authoritative source for authentication (GitHub OAuth), session management, database persistence (PostgreSQL), GitHub API proxying, and real-time collaboration signaling via WebSockets.
- **Frontend (`client/`)**: A Single Page Application (SPA) built with React and Vite. It provides the user interface for authentication, an administrative portal for access control, a dashboard for users to access permitted repositories, and a collaborative code editor integrating the Monaco Editor with real-time peer presence and peer document viewing.

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
  - `wsPlugin.ts`: Intercepts connection upgrades to the `/ws` endpoint. It expects a `?token=` query parameter containing a valid JWT. If valid, the connection is upgraded, the decoded user context is bound to an `AuthenticatedSocket`, and it begins routing messages via `handleMessage` / `handleDisconnect`.
- `src/ws/`:
  - `roomManager.ts`: Maintains an in-memory `Map<string, Set<AuthenticatedSocket>>`. Provides methods to add/remove connections to deterministic room identifiers (e.g., `repoId:branch:filePath`), broadcast messages to all peers in a room (with optional sender exclusion), query the current peer list of a room, remove a socket from all rooms on disconnect, and look up a specific peer's socket by username within a room via `getSocketByUsername`.
  - `messageHandler.ts`: A protocol router that parses incoming stringified JSON messages from clients (matching `ClientMessage` types) and invokes the appropriate handler. Supports five message types: `join_room`, `leave_room`, `diff_update`, `request_peer_doc`, and `doc_response`. Also exposes `handleDisconnect` to clean up all rooms on socket closure and broadcast `peer_left` to remaining peers.
  - `ws.types.ts`: Strictly types the WebSocket protocol surfaces between `ClientMessage` and `ServerMessage`. Defines the `DiffPatch` schema mapping 1:1 to Monaco Editor's `IModelContentChange`. Client messages include `join_room`, `leave_room`, `diff_update`, `request_peer_doc`, and `doc_response`. Server messages include `room_joined` (with peer list), `peer_joined`, `peer_left`, `peer_diff`, `remote_push`, `doc_requested`, and `peer_doc_content`.
- `src/auth/`:
  - `jwt.ts`: Exports utilities to sign and cryptographically verify JWTs using the active `JWT_SECRET`. Encodes properties like `userId`, `username`, `role`, `avatarUrl`, and `color`.
  - `crypto.ts`: Implements synchronous AES-256-CBC encryption to obscure sensitive values (like standard GitHub personal access tokens) in the database before storage using the `ENCRYPTION_KEY`.
  - `github.strategy.ts`: The core Passport OAuth strategy. It manages the post-GitHub validation handshake: evaluating if the user is the designated admin, verifying the organization code, creating or updating user entries in the database, and assigning predefined avatars/colors.
- `src/services/`:
  - `github.service.ts`: An abstraction over the `@octokit/rest` library. It exposes specific functionalities like fetching repositories, listing branches, obtaining a repository's recursive tree, and fetching blob file content via base64 decoding.
  - `token.service.ts`: Fetches and decrypts the encrypted GitHub tokens stored in the database.
- `src/db/`:
  - `client.ts`: Constructs the `pg.Pool` connection resolving against `DATABASE_URL`.
  - `seedOrgCode.ts` & `seedRoles.ts` & `seedUsers.ts`: Bootstrapping utilities to auto-configure table presets based on the current `.env`.
  - `migrations/`:
    - `001_init.sql`: Base structures establishing `users` and `organizations`.
    - `002_admin_portal.sql`: The advanced RBAC schemas introducing `groups`, `roles`, and relational mappings for repository visibility.

### 2.2 Frontend (`client/`)

- `src/main.tsx` & `src/App.tsx`: App configuration injecting the React Router DOM logic defining core application URLs and protecting specific routes behind `<RequireAuth>` and `<RequireAdmin>` wrapper components. Routes include `/login`, `/auth/callback`, `/invalid-code`, `/dashboard`, `/browse/:repoId`, and `/admin`.
- `src/pages/`:
  - `Login.tsx`: The primary interaction surface capturing the organizational code before routing the user into OAuth via `window.location`.
  - `AuthCallback.tsx`: A silent rendering component intercepting the OAuth redirect callback, plucking the `token` from the URL parameters, writing it to `localStorage`, and cleanly rerouting to the dashboard.
  - `InvalidCode.tsx`: A styled error page displayed when a user provides an incorrect organization code, with a link back to the login page.
  - `AdminDashboard.tsx`: A complex administrative view. Divided into three major domains: Connecting personal GitHub repositories to the IDE system; managing arbitrary Roles and Groups bridging specific Users; and configuring granular Repository Access restrictions using multi-select interfaces linked directly to the Role/Group identifiers in the database.
  - `Dashboard.tsx`: The standard user entry point invoking `/api/repos` to formulate a grid of accessible repositories allowing the user to initiate a browsing session.
  - `RepoBrowser.tsx`: A comprehensive layout mirroring standard IDE workflows. Features a recursive DOM representation (`TreeView`) of a selected branch's file tree, an embedded editable `@monaco-editor/react` instance synced via WebSockets, a `PresenceAvatars` dropdown showing peers in the current file-room, and a collapsible read-only peer editor pane that displays another peer's live document with incoming diffs applied in real time. Editor changes are broadcast as `diff_update` messages. The peer viewing system uses a request/response protocol: clicking a peer sends `request_peer_doc`, the target auto-responds with their current editor content, and subsequent `peer_diff` messages are applied live to the read-only pane.
  - `IDE.tsx`: Empty placeholder file (awaiting future implementation).
- `src/components/`:
  - `PresenceAvatars.tsx`: A presence indicator and peer-selection dropdown component. Renders stacked avatar circles showing up to 4 peers with a viewer count badge. Clicking opens a dropdown listing all other peers in the current room, each clickable to toggle the peer viewing pane. Uses a deterministic color hash for fallback avatar backgrounds and integrates with the `usePresenceStore`.
  - `Editor.tsx`: Empty placeholder file (component logic currently inlined in `RepoBrowser.tsx`).
  - `FileTree.tsx`: Empty placeholder file (component logic currently inlined in `RepoBrowser.tsx` as `TreeView`).
  - `BranchSelector.tsx`: Empty placeholder file (branch selection currently inlined in `RepoBrowser.tsx`).
- `src/api/`:
  - `client.ts`: Exposes a robust `axios` instance heavily integrated with interceptors appending the `collabide_jwt` authorization header to all outbound payloads transparently.
  - `admin.ts`: A centralized repository of specific async functions communicating heavily typed payloads to the variety of backend API endpoints.
- `src/store/`:
  - `repoStore.ts`: A Zustand global store retaining the current state of selected repositories, fetched github trees, and branch data decoupled from specific unmount phases of React functional components.
  - `fileStore.ts`: Tracks open file paths, active branches, and retains mappings of string payloads caching open file contents across views.
- `src/hooks/`:
  - `useAuth.ts`: Encapsulates operations against `localStorage` mapping token fetching, simple client-side JWT sub-parsing (ignoring signatures), and establishing clear `isLoggedIn` boolean abstractions. Exports `getToken`, `getUser`, `isLoggedIn`, and `logout` utilities.
  - `useWebSocket.ts`: Manages a singleton WebSocket connection to the server's `/ws` endpoint using the JWT from `localStorage`. Exposes a Zustand store (`useWsStore`) tracking connection status (`connecting`, `open`, `closed`) and the raw `WebSocket` instance. Implements automatic reconnection with exponential backoff (capped at 30s). Provides a global message handler registry (`onServerMessage`) that fan-outs parsed `ServerMessage` objects to all subscribed listeners. The `useWebSocket` hook should be called once at a high-level component (e.g. `RepoBrowser`).
  - `usePresence.ts`: Manages room membership and peer presence as the active file changes. Maintains a Zustand store (`usePresenceStore`) containing the current `roomId` and a `peers` array. Automatically sends `join_room` / `leave_room` messages when the active file path changes and subscribes to `room_joined`, `peer_joined`, and `peer_left` server messages to keep the store in sync. Handles cleanup on unmount.
- `src/ui/`:
  - `Shell.tsx`: A reusable page shell/layout wrapper providing a sticky top navigation bar with the "CollabIDE" branding, contextual breadcrumb title, navigation links (Dashboard, Admin for privileged users), and a logout button displaying the current username. Wraps children in a centered content container.
  - `styles.ts`: A centralized design token module exporting color constants (`colors`), typography settings (`font`), and reusable CSS-in-JS style objects (`cardStyle`, `buttonBase`, `buttonPrimary`, `inputStyle`) shared across the application. Uses a dark-mode GitHub-inspired palette.

## 3) Core Sub-systems Documentation

### 3.1 Authentication & The Entry Gate

The entry protocol ensures no external user can enter without first knowing a specific organizational pass phrase. The flow executes as follows:
1. The user inputs their org code in `Login.tsx`, hitting `POST /auth/verify-code`.
2. The server bcrypt compares this code against the lone entry in the `organizations` table.
3. If validated, the client unlocks the "Login with GitHub" function pointing local routing to `GET /auth/github?orgCode=<encoded>`.
4. Passport intercepts this URL, injects the `orgCode` into a verified `state` object, and redirects the user externally to GitHub's OAuth systems.
5. Post-authorization, GitHub redirects to `GET /auth/github/callback`. The internal Passport strategy reconstructs the `state`, re-validates the `orgCode`, accesses the GitHub user profile, and processes the database insertion.
6. A JWT is securely signed including the internal numeric database `userId` and returned to the client as a URL parameter for `localStorage` persistence.
7. If the org code is invalid, the client is redirected to `/invalid-code` displaying a user-friendly error page.

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
- Upon valid execution, structural logic dynamically assigns peers (sockets) into discrete rooms mapped against unique `roomId` expressions built from combining `repoId:branch:filePath`.
- The `messageHandler` routes five distinct client message types:
  - `join_room`: Adds the socket to a room, responds with `room_joined` (including the full peer list), and broadcasts `peer_joined` to existing members.
  - `leave_room`: Removes the socket from the room and broadcasts `peer_left` to remaining members.
  - `diff_update`: Receives Monaco Editor change patches from the editing client and relays them as `peer_diff` to all other sockets in the room.
  - `request_peer_doc`: Forwards a `doc_requested` event to a specific peer's socket (looked up by username via `getSocketByUsername`), asking them to share their current document content.
  - `doc_response`: Receives the target peer's full document content and forwards it as `peer_doc_content` to the requesting socket.
- On disconnect, `handleDisconnect` removes the socket from all rooms it belonged to and broadcasts `peer_left` to each affected room.
- The client-side `useWebSocket` hook establishes a single WebSocket connection per session with automatic exponential-backoff reconnection. A global handler registry fans out incoming messages to all subscribers (presence, peer viewing, diff application).
- The client-side `usePresence` hook synchronizes room membership with the active file, maintaining a Zustand store of the current room's peer list.

### 3.5 Peer Document Viewing

A two-pane collaborative viewing system allows users to selectively observe another peer's live edits in a read-only side panel.
1. The `PresenceAvatars` component shows who is currently viewing the same file. Clicking on a peer in the dropdown triggers `handleSelectPeer` in `RepoBrowser`.
2. A `request_peer_doc` message is sent to the server targeting the selected peer's username. The server uses `getSocketByUsername` to route a `doc_requested` event to that specific peer's socket.
3. The target peer's client auto-responds (via the `onServerMessage` listener in `RepoBrowser`) by reading its current editor value and sending a `doc_response` back.
4. The requester receives `peer_doc_content`, loads it into a read-only Monaco Editor in the collapsible right pane, and marks the document as ready.
5. Subsequent `peer_diff` messages from the selected peer are applied in real-time to the read-only editor using `editor.executeEdits()`, keeping the view synchronized.
6. If diffs arrive before the initial document is loaded, they are queued in `pendingPeerDiffsRef` and applied once the base document arrives.
7. Switching files or closing the pane resets peer viewing state. If the selected peer disconnects (`peer_left`), the pane is automatically closed.

## 4) Structural Ambiguities & Future Milestones

While substantial administrative, access controlling, and routing hierarchies exist securely mapping internal operations smoothly, the structure remains technically incomplete around specific milestones:

- **Monaco CRDT / Operational Transformation Integration:** The socket layers accurately parse and broadcast raw `diff_update` patterns to mapped active presence rooms, but the frontend lacks correct Operational Transform (OT) or CRDT bindings on the `@monaco-editor/react` components to physically apply sequential patch modifications overlapping concurrently without explicit disruption sequences occurring rapidly.
- **GitHub Webhook Syncs:** The system evaluates GitHub structures statically based on polling requests when paths are actively clicked traversing the `TreeView` inside the `RepoBrowser`. It lacks dynamic asynchronous web hooks pushing explicit `remote_push` mechanisms notifying logged users if targeted code trees are modified natively across external GitHub operations. (The `remote_push` server message type is defined but not yet wired.)
- **Save Operations:** Write-back commands mapping modified internal abstractions correctly to Octokit Commit APIs appending explicit data successfully against targeted active branches are lacking direct bindings.
- **Component Extraction:** Several reusable components (`Editor.tsx`, `FileTree.tsx`, `BranchSelector.tsx`) exist as empty placeholder files. Their logic is currently inlined within `RepoBrowser.tsx` (e.g. `TreeView`, branch `<select>`, Monaco `<Editor>` instances) and should eventually be extracted for cleaner separation.
- **IDE.tsx Placeholder:** The `IDE.tsx` page exists as an empty file, likely intended as a future dedicated IDE-focused view distinct from the current `RepoBrowser`.
