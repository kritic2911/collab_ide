# CollabIDE: Webhooks & Live Awareness

## Phase 1: GitHub Webhooks
- [x] DB migration 003: `webhook_events` table
- [x] Server: `POST /webhooks/github` with signature verification (raw body HMAC)
- [x] Server: `GET /api/repos/:repoId/events` (paginated)
- [x] Client: `WebhookLog` component (+ live `remote_push` over WS)

## Phase 2: WebSocket Infrastructure
- [x] Install `@fastify/websocket`
- [x] Server: WS plugin with JWT auth + room management (`join_room`/`leave_room`/`diff_update`) + `remote_push`
- [x] Client: `useWebSocket` hook (native WS, auto-reconnect)

## Phase 3: Live Awareness (Presence + Edit Highlights)
- [x] `collabStore` — peers, selectedPeerUsername, `DiffPatch` patches + seq
- [x] `PresenceBar` — colored dots, click to highlight
- [x] `CollabEditor` — Monaco with local edits + remote highlight overlay
- [x] [IDE.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/pages/IDE.tsx) — wire up FileTree + PresenceBar + CollabEditor
- [x] [App.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/App.tsx) — add `/ide/:repoId` route

## Phase 4: Test Suite
- [ ] Server: Vitest config + webhook tests + WS tests
- [ ] Client: Vitest config + collabStore tests + PresenceBar tests + useWebSocket tests

## Phase 5: Verification
- [ ] Run all tests green
- [ ] Manual test: webhook → DB + WebhookLog
- [ ] Manual test: two tabs → presence dots + edit highlights
