# WebSocket Infrastructure — Walkthrough

## What Was Built

Person 1's WebSocket layer is complete. Five files were created/modified:

| File | Purpose |
|---|---|
| [ws.types.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts) | [DiffPatch](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#12-22), [ClientMessage](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#26-43) (3 types), [ServerMessage](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#47-82) (5 types), [AuthenticatedSocket](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#7-8) |
| [roomManager.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts) | `Map<roomId, Set>` with [joinRoom](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#17-28), [leaveRoom](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#29-42), [broadcastToRoom](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#43-64), [getRoomId](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#8-16), [getRoomPeers](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#65-77), [removeFromAllRooms](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#78-98) |
| [messageHandler.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/messageHandler.ts) | Routes `join_room`, `leave_room`, `diff_update`; handles `close` via [handleDisconnect](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/messageHandler.ts#42-57) |
| [wsPlugin.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/plugins/wsPlugin.ts) | Registers `@fastify/websocket`, `GET /ws` endpoint with JWT auth from `?token=` query param |
| [index.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/index.ts) | Registers [wsPlugin](file:///c:/Users/riddh/Desktop/collab_ide/server/src/plugins/wsPlugin.ts#8-55) after passport |

## Verification

- `tsc --noEmit` → **0 errors**
- `npm install` added `@fastify/websocket` + `@types/ws`

## Exports Person 2 Depends On

From [roomManager.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts):
- [broadcastToRoom(roomId, msg, excludeConn?)](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#43-64) — for the webhook handler to push `remote_push` messages
- [getRoomId(repoId, branch, filePath)](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#8-16) — format: `"${repoId}:${branch}:${filePath}"`

From [ws.types.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts):
- [ServerMessage](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#47-82) — includes the `remote_push` type for webhook broadcasts
- [DiffPatch](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/ws.types.ts#12-22) — for Monaco integration on the frontend

## What You Need To Do (Person 2)

1. **Connect from the frontend** — open a WebSocket to `ws://localhost:3000/ws?token=<jwt>` (grab the JWT from localStorage)
2. **Send `join_room`** when a user opens a file in the editor:
   ```json
   { "type": "join_room", "repoId": "1", "branch": "main", "filePath": "src/index.ts" }
   ```
3. **Listen for `room_joined`** — you'll get back the `roomId` (store it) and the current `peers[]` list
4. **Send `diff_update`** on Monaco `onDidChangeModelContent`:
   ```json
   { "type": "diff_update", "roomId": "<from room_joined>", "patches": [...], "seq": 1 }
   ```
5. **Apply incoming `peer_diff`** messages to the Monaco editor model
6. **Handle `peer_joined` / `peer_left`** for the presence UI (username, avatarUrl)
7. **Send `leave_room`** when the user closes a file tab or navigates away
8. **(Optional)** If building the webhook handler for `remote_push`, import [broadcastToRoom](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#43-64) and [getRoomId](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts#8-16) from [roomManager.ts](file:///c:/Users/riddh/Desktop/collab_ide/server/src/ws/roomManager.ts) — those are the only two things you need
