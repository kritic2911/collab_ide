# Webhooks — CollabIDE

## Overview

GitHub webhooks let CollabIDE receive real-time notifications when events occur in connected repositories (pushes, pull requests, etc.). Events are stored in the database and surfaced in the client.

## Setup

### 1. Add webhook secret to `.env`

```env
GITHUB_WEBHOOK_SECRET=your-random-secret-here
```

Generate a secure random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Run migration 003

```sql
-- Apply server/src/db/migrations/003_webhooks.sql to your database
psql -d collab_ide -f server/src/db/migrations/003_webhooks.sql
```

### 3. Configure webhook on GitHub

1. Go to your GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: `https://your-server.com/webhooks/github` (or `http://localhost:3001/webhooks/github` for local dev — use ngrok/smee for tunneling)
3. **Content type**: `application/json`
4. **Secret**: same value as `GITHUB_WEBHOOK_SECRET`
5. **Events**: select "Push" and "Pull requests" (or "Send me everything")

## API Endpoints

### `POST /webhooks/github`

Called by GitHub. **Not behind JWT auth** — secured via HMAC-SHA256 signature verification.

| Header | Description |
|--------|-------------|
| `X-Hub-Signature-256` | HMAC signature of the payload |
| `X-GitHub-Event` | Event type (`push`, `pull_request`, etc.) |

**Response**: `200 { received: true }` or `200 { ignored: true }` for untracked repos.

### `GET /api/repos/:repoId/events?limit=20&offset=0`

Returns paginated webhook events. **Requires JWT auth + repo access.**

**Response**:
```json
{
  "events": [
    {
      "id": 1,
      "event_type": "push",
      "action": null,
      "sender_username": "octocat",
      "payload": { ... },
      "received_at": "2026-03-29T13:45:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

## Live updates (WebSocket)

For GitHub `push` events, after the webhook is stored in Postgres the server broadcasts a `remote_push` message over `/ws` to every connected client in rooms for the same `repoId` + `branch`.

Room membership is managed by the collaboration protocol:
- client sends `join_room` when the user opens a specific file in the IDE
- client sends `leave_room` when they switch files / leave the IDE

### Live message schema (`remote_push`)

```json
{
  "type": "remote_push",
  "roomId": "123:main:src/components/Editor.tsx",
  "pushedBy": "octocat",
  "branch": "main",
  "changedFiles": ["src/components/Editor.tsx"],
  "commitSha": "abc1234"
}
```

## To-do (Webhooks + Live editing protocol clarity)

### Align WebSocket protocol to `DiffPatch`

The upcoming goal is to unify Monaco edit awareness and webhook-driven updates using one atomic patch format, so nobody invents a custom diff representation.

Use the following protocol types exactly (no transformation). Monaco gives you change events with a `range` (start/end line+column) and the new `text`. Wrap that directly:

#### DiffPatch (atomic unit)
```ts
type DiffPatch = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  text: string        // the replacement text ("" means deletion)
  rangeLength: number // chars replaced, needed for OT conflict detection later
}
```

Monaco mapping (1:1 to `IModelContentChange`):
- `range` -> `DiffPatch.range`
- `text` -> `DiffPatch.text` ("" means deletion)
- `rangeLength` -> `DiffPatch.rangeLength`

#### ClientMessage (browser -> server)
```ts
type ClientMessage =
  | {
      type: 'join_room'
      repoId: string
      branch: string
      filePath: string   // e.g. "src/components/Editor.tsx"
    }
  | {
      type: 'leave_room'
      roomId: string     // server-computed ID, received in room_joined
    }
  | {
      type: 'diff_update'
      roomId: string
      patches: DiffPatch[]  // array because Monaco batches rapid changes
      seq: number           // monotonic counter per client, helps with ordering
    }
```

#### ServerMessage (server -> browser)
```ts
type ServerMessage =
  | {
      type: 'room_joined'
      roomId: string       // the computed ID — client stores this for future sends
      peers: {
        username: string
        avatarUrl: string | null
      }[]
    }
  | {
      type: 'peer_joined'
      roomId: string
      username: string
      avatarUrl: string | null
    }
  | {
      type: 'peer_left'
      roomId: string
      username: string
    }
  | {
      type: 'peer_diff'
      roomId: string
      username: string
      patches: DiffPatch[]
      seq: number          // mirrors the client's seq, for ordering
    }
  | {
      type: 'remote_push'
      roomId: string
      pushedBy: string
      branch: string
      changedFiles: string[]
      commitSha: string    // short SHA for the banner: "abc1234 pushed to main"
    }
```

### getRoomId (must be identical on server + client)
```ts
function getRoomId(repoId: string, branch: string, filePath: string): string {
  return `${repoId}:${branch}:${filePath}`
  // e.g. "repo_123:main:src/components/Editor.tsx"
}
```
Normalization rule before calling `getRoomId`:
- no leading slash
- forward slashes only
- stable casing

### Remaining work
- Replace websocket awareness messages with `join_room` / `leave_room` / `diff_update`.
- Convert Monaco `IModelContentChange[]` into `DiffPatch[]` and send with `seq`.
- Drive highlighting from `peer_diff` patches (not line lists).
- Ensure websocket leave stops updates.
- For GitHub `push`, broadcast `ServerMessage.type = 'remote_push'` (replace current `webhook-event`) with the fields above.

## Architecture

```
GitHub ─── POST /webhooks/github ──→ Signature check ──→ Match repo ──→ DB insert ──→ WS broadcast (subscribers)
                                          │
                                     401 if bad sig
```

## Database Schema

```sql
webhook_events (
  id              SERIAL PRIMARY KEY,
  repo_id         INT  → connected_repos(id),
  event_type      VARCHAR(50),
  action          VARCHAR(50),
  sender_username VARCHAR(255),
  payload         JSONB,
  received_at     TIMESTAMP
)
```

---

*This file is updated incrementally as the feature evolves.*
