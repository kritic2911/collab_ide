# Changelog

## 2026-04-18 — GitHub Webhooks & Live Awareness
### Real-Time Pipeline for Repository Sync
Completed the end-to-end integration of GitHub webhooks to power file synchronization and branch-wide push notifications. The backend now securely ingests GitHub payloads via a custom parser, verifies HMAC-SHA256 signatures, logs them persistently, and triggers real-time UI updates across all WebSocket endpoints via Redis PubSub broadcasting.

### Key Features
- **Secure Webhook Ingestion** — Uses `crypto.timingSafeEqual` over Fastify raw Buffer captures to ensure 100% accurate signature validation, preventing timing attacks.
- **Persistent Local Logging** — Added `server/webhooks.log` and `server/server.log` that safely append timestamped events and survive process restarts.
- **Horizontal Scaling via PubSub** — Refactored Webhooks to publish to a `global:webhook_pushes` Redis channel instead of local-only memory. All backend nodes subscribe to this channel, ensuring cross-machine delivery.
- **Branch-Wide Live Awareness** — When a user pushes code, any peer viewing *any file* on that branch instantly receives an alert banner: `"[Username] pushed [file] — your diff may now conflict."`, rather than being constrained to a per-file room subscription.
- **Peer Diff Synchronization** — The diff window completely avoids shadow patches and directly requests the peer's actual document state over native WebSockets for a perfect side-by-side Monaco diff comparison.

### Files Added
- `server/src/utils/fileLogger.ts` — Persistent logging utility.
- `webhooks_implementation.md` — Complete architectural and setup guide for the webhooks pipeline.

### Files Modified
- `server/src/routes/webhook.routes.ts` — Wrote robust raw payload extraction to fix a Fastify JSON stream preParsing bug; changed from local delivery to `publishGlobalWebhook`.
- `server/src/state/pubsub.ts` — Added `publishGlobalWebhook` and `subscribeToGlobalWebhooks`.
- `server/src/ws/roomManager.ts` — Implemented `broadcastToBranch`, iterating over `localSockets` to find all clients viewing the updated branch.
- `server/src/index.ts` — Bootstrapped the Redis subscriber for global webhooks.
- `server/.env.example` — Added necessary webhook secret keys.
## 2026-04-14 — In-File Chat Panel
### Real-Time Encrypted Chat with Persistence
Added a collapsible chat panel to the collaborative IDE, enabling users editing the same file to communicate in real-time. Chat messages are encrypted at rest using AES-256-CBC (same `ENCRYPTION_KEY` as GitHub tokens) and stored permanently in PostgreSQL. When users join a room, the last 7 days of chat history are loaded automatically. Older messages (up to 30 days) can be paginated via a "Load older" button. A daily cleanup job removes messages older than 30 days.

### Key Features
- **Real-time messaging** — Messages broadcast to all peers in the same file room via Redis Pub/Sub
- **Encryption at rest** — All messages stored as `iv:ciphertextHex` in the `message_enc` column; decrypted server-side before delivery
- **7-day auto-load + 30-day pagination** — Initial load fetches last 7 days (max 50); "Load older" paginates up to 30 days using cursor-based (`id < $beforeId`) queries
- **30-day cleanup** — `setInterval` in server runs `DELETE WHERE created_at < NOW() - INTERVAL '30 days'` every 24 hours
- **Delete own messages** — Users can delete their own messages; deletion broadcasts to all peers in real-time
- **Collapsible overlay** — Floating 💬 button with unread badge when collapsed; 320px glassmorphism side panel when expanded
- **Auto-scroll with scroll-lock** — Panel auto-scrolls to new messages unless the user has scrolled up to read history

### Files Added
- `server/src/db/migrations/005_chat.sql` — `chat_messages` table with encrypted `message_enc` column, indexed on `(room_id, created_at DESC)` and `(user_id)`
- `server/src/services/chatService.ts` — Service layer: `saveMessage()` (encrypt→INSERT), `getHistory()` (SELECT→decrypt, 7-day window), `getOlderMessages()` (cursor pagination, 30-day cap), `deleteMessage()` (ownership-verified DELETE)
- `client/src/store/chatStore.ts` — Zustand store managing messages, panel open/closed state, unread count, pagination state, message dedup by PG serial id
- `client/src/components/ChatPanel.tsx` — Collapsible right-edge overlay UI with date separators, hover-to-delete, load older button, Enter-to-send

### Files Modified
- `server/src/index.ts` — Added 24-hour chat cleanup interval + graceful shutdown cleanup
- `server/src/ws/ws.types.ts` — Added `chat_message`, `chat_load_older`, `chat_delete` (client→server) and `chat_broadcast`, `chat_history`, `chat_older_history`, `chat_deleted` (server→client)
- `server/src/state/pubsub.ts` — Extended event union with `chat_message` and `chat_deleted`
- `server/src/ws/messageHandler.ts` — Added `onChatMessage`, `onChatLoadOlder`, `onChatDelete` handlers; extended `onJoinRoom` to send chat history after hydration
- `server/src/ws/roomManager.ts` — Added `chat_message` and `chat_deleted` PubSub relay cases
- `client/src/hooks/useCollabSocket.ts` — Added `chat_history`, `chat_broadcast`, `chat_older_history`, `chat_deleted` message handlers
- `client/src/pages/IDE.tsx` — Mounted `ChatPanel`, added `useChatStore.clear()` on file switch, added `position: relative` to editor column

## 2026-04-11 - Branch `caching`
### End-to-End Pipeline Integrated
This clean commit finalizes the integration of the real-time collaborative IDE pipeline backed by a Redis state layer (L2) and an in-memory LRU cache (L1). The pipeline tracks active users in real-time, displays live patches in the peer diff window, and safely persists state using Redis.

### Files Added/Modified
- **Configuration:** `.gitignore`, `docker-compose.yml`, `server/package.json`, `server/package-lock.json`
- **Frontend (Added/Modified):** `client/src/App.tsx`, `client/src/api/admin.ts`, `client/src/api/repo.ts`, `client/src/components/CollabEditor.tsx`, `client/src/components/PeerDiffGutter.tsx`, `client/src/components/PeerDiffWindow.tsx`, `client/src/components/PresenceBar.tsx`, `client/src/components/WebhookLog.tsx`, `client/src/hooks/useCollabSocket.ts`, `client/src/hooks/useRoom.ts`, `client/src/hooks/useWebSocket.ts`, `client/src/lib/wsUrl.ts`, `client/src/pages/Dashboard.tsx`, `client/src/pages/IDE.tsx`, `client/src/store/collabStore.ts`
- **Backend (Added/Modified):** `server/src/index.ts`, `server/src/ws/messageHandler.ts`, `server/src/ws/roomManager.ts`, `server/src/ws/ws.types.ts`, `server/src/db/migrations/003_webhooks.sql`, `server/src/db/migrations/004_add_webhook_id.sql`, `server/src/routes/webhook.routes.ts`, `server/src/state/*`

### Integration Notes from Contributor Branches
- **login [Riddhika Arora]:** Included foundational auth updates and codebase improvements.
- **acd61fb [Riddhika Arora]:** Basis of the WebSocket server allowing bidirectional diff relays.
- **[kritic2905]:** Webhook skeleton logic, side-by-side iterative peer diff viewer structure, and presence bubble UX.
