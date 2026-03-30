# GitHub Webhooks & Real-Time Collaboration

Add GitHub webhook ingestion and real-time "live awareness" editing to CollabIDE. Users each work on their own local copy — they can **see** what others are editing (highlighted in each user's color) but **cannot modify** each other's files. Merging happens through normal git pull with merge conflict resolution. Seeing others' live progress helps anticipate and resolve conflicts.

## Collaboration Model

- Each user edits their **own copy** of a file (read/write for self, read-only view of others)
- **Presence dots** in a top bar — Google Docs-style colored circles with initials
- **Click a dot** → the lines that user has edited/added/deleted get highlighted in their color on your editor
- No shared cursor or co-editing — this is **awareness**, not co-authoring
- Native `WebSocket` on the client (yes, to avoid the overhead of socket.io — no fallback polling, no extra abstraction layer, just raw WS which all modern browsers support)

## User Review Required

> [!IMPORTANT]
> **`GITHUB_WEBHOOK_SECRET`** must be added to your [.env](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/.env) and set as the secret when creating webhooks on GitHub repos (Settings → Webhooks → Add webhook).

---

## Proposed Changes

### Database

#### [NEW] [003_webhooks.sql](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/db/migrations/003_webhooks.sql)

`webhook_events` table: `id`, `repo_id` (FK), `event_type`, `action`, `sender_username`, `payload` (JSONB), `received_at`. Index on [(repo_id, received_at DESC)](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/App.tsx#22-56).

---

### Server — Webhooks

#### [NEW] [webhook.routes.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/routes/webhook.routes.ts)

- `POST /webhooks/github` — receives payloads, verifies `X-Hub-Signature-256`, matches repo, persists to DB, broadcasts via WS
- `GET /repos/:repoId/events` — paginated recent events (JWT-protected)

#### [MODIFY] [index.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/index.ts)

Register webhook routes + WebSocket plugin. Add `GITHUB_WEBHOOK_SECRET` to env.

---

### Server — WebSocket

#### [NEW] [ws.plugin.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/plugins/ws.plugin.ts)

- `@fastify/websocket` with JWT auth on connect (token as query param)
- Room-based: `getRoomId(repoId, branch, filePath)` = `${repoId}:${branch}:${filePath}`
- Message types:
  - `join_room` / `leave_room` → presence: `room_joined`, `peer_joined`, `peer_left`
  - `diff_update` → server relays changes as `peer_diff` ({`patches: DiffPatch[]`, `seq`})
  - `remote_push` → server relays GitHub `push` events as banner/notifications

No edit merging — each user's edits are tracked only as **diffs from their starting point**, broadcast for awareness.

---

### Client — Collaboration

#### [NEW] [useWebSocket.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/hooks/useWebSocket.ts)

Native `WebSocket` hook with JWT auth, auto-reconnect, `send(type, data)` + event listeners.

#### [NEW] [collabStore.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/store/collabStore.ts)

Zustand store:
- `peers`: Map of userId → `{ username, color, avatarUrl, editedLines: {added: number[], modified: number[], deleted: number[]} }`
- `peers`: Map of `username` → `{ username, avatarUrl, patches: DiffPatch[], seq }`
- `selectedPeerUsername`: which peer's patches are highlighted (null = none)
- `roomId` (set from `room_joined`), actions for join/leave/update

#### [NEW] [CollabEditor.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/components/CollabEditor.tsx)

- Monaco editor wrapping — user edits their own copy
- Tracks local changes via `onDidChangeModelContent` → diffs from original → broadcasts changed line ranges
- When `selectedPeerId` is set, renders that peer's changed lines as colored gutter + line highlights using Monaco `deltaDecorations`
- No remote edits applied to local model — purely visual highlights overlay

#### [NEW] [PresenceBar.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/components/PresenceBar.tsx)

- Horizontal bar of colored dots (Google Docs style) — one per online user in the current file
- Each dot shows initials, colored border matching user's `color_hex`
- Click a dot → toggles highlight of that user's edits on the editor
- Active/selected dot gets a ring/glow effect

#### [NEW] [WebhookLog.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/components/WebhookLog.tsx)

Timeline of webhook events (pushes, PRs) for the current repo.

#### [MODIFY] [IDE.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/pages/IDE.tsx)

Main collaborative page: FileTree (left) + PresenceBar (top) + CollabEditor (center). Branch selector at top.

#### [MODIFY] [App.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/App.tsx)

Add route `/ide/:repoId` → IDE page.

#### [NEW] [repo.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/api/repo.ts)

API wrapper for `fetchWebhookEvents(repoId)`.

---

### Package Dependencies

| Where | Package | Why |
|-------|---------|-----|
| Server | `@fastify/websocket` | WebSocket support |
| Server (dev) | `vitest` | Test runner |
| Client (dev) | `vitest`, `@testing-library/react`, `jsdom` | Tests |

---

### Test Suite

#### Server Tests ([NEW] `server/src/__tests__/`)

- **`webhook.test.ts`** — signature verification (valid/invalid/missing), event persistence, unknown repo rejection
- **`ws.test.ts`** — JWT auth on connect (valid/invalid/missing token), room join/leave, presence broadcast, diff_update/peer_diff relay
- **`webhookEvents.test.ts`** — pagination, auth required, repo access check

#### Client Tests ([NEW] `client/src/__tests__/`)

- **`collabStore.test.ts`** — peer add/remove/update, selectedPeerId toggle
- **`PresenceBar.test.tsx`** — renders dots for peers, click toggles selection
- **`useWebSocket.test.ts`** — connect/reconnect/send behavior

#### Test Config Files

- [NEW] `server/vitest.config.ts`
- [NEW] `client/vitest.config.ts`

---

## Verification Plan

### Automated Tests
```bash
# Server
cd server && npx vitest run

# Client
cd client && npx vitest run
```

### Manual Verification
1. **Webhooks**: `curl` a simulated push event → verify it appears in DB and WebhookLog
2. **Presence**: Open `/ide/:repoId` in two tabs → both see each other's dots
3. **Live highlights**: Edit a file in tab A → click tab A's dot in tab B → see highlighted lines in A's color
4. **Disconnect**: Close tab A → dot disappears from tab B
