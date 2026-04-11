# Changelog

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
