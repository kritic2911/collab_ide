# GitHub Webhooks & Real-Time Collaboration Implementation

We have successfully added GitHub webhook ingestion and real-time "live awareness" editing to CollabIDE. Users each work on their own local copy — they can **see** what others are editing (highlighted in each user's color) but **cannot modify** each other's files. Merging happens through normal git pull with merge conflict resolution. Seeing others' live progress helps anticipate and resolve conflicts.

## Collaboration Model

- Each user edits their **own copy** of a file (read/write for self, read-only view of others).
- **Presence dots** in a top bar specify who else is viewing the local file.
- **Hovering edits** → Hovering your mouse over peer highlights displays a Monaco editor tooltip containing the exact strings their peers added, modified, or removed live on the editor.
- **Push Events** → A webhook logger and push notification banner will warn users instantly when someone pushes updates to their currently checked out branch.
- Native `WebSocket` on the client.

## Important Configurations

> [!IMPORTANT]
> **`GITHUB_WEBHOOK_SECRET`** must be added to your `server/.env` and securely referenced when spinning up webhooks.
> **`WEBHOOK_TARGET_URL`** must be specified accurately tracking your local tunneling routing software (e.g. `https://xxx.ngrok-free.app/webhooks/github`) so GitHub properly forwards requests to the proper path.

---

## Final Changes Handled

### Database Updates

- **`003_webhooks.sql`**: Configured `webhook_events` tracking schema mapped closely to `repo_id`.
- **`004_add_webhook_id.sql`**: Appended `webhook_id` references to `connected_repos`.

---

### Backend Components

- **`webhook.routes.ts`** — Support for JSON and FormBody decoding. Listens on `POST /webhooks/github`, verifies `X-Hub-Signature-256`, handles push events (`commits[].modified`), extracts exact file paths modified, stores to DB, and broadcasts `remote_push` banners via WS.
- **`admin.routes.ts`** — Programmatic `POST` generation registering webhooks when connecting an external repository via the Github API.
- **`index.ts`** — Reordered plugin registries to properly bind Fastify WS and FormBody.
- **`ws.plugin.ts`** —
  - Room computations: `${repoId}:${branch}:${filePath}`
  - Authentication parsed through `url.searchParams.get('token')`
  - Routes payload formats parsing `{ type: 'join_room', repoId, branch, filePath }` into distinct file-level rooms to reduce message broadcasting bloat.

---

### Frontend Components

- **`useCollabSocket.ts`**
  - Native `WebSocket` hook directly tied to `collabStore` (Zustand). Maps responses (`peer_joined`, `peer_diff`, etc.) directly into state.
  - Generates custom `collab:remote_push` window events.
- **`useRoom.ts`**
  - Handles dynamic `join_room` dispatches when checking out different files within the Monaco Editor.
- **`collabStore.ts`**
  - Iteratively *accumulates* user patch sequences so edits aren't overwritten visually when other collaborators pause their typing strokes.
- **`PeerDiffGutter.tsx`**
  - Consumes editor variables and leverages `createDecorationsCollection` to colorize Monaco gutters according to user themes.
  - Implements rich markdown hover messages denoting explicit insertion and deletion sequences.
- **`PresenceBar.tsx`**
  - Top boundary dots for each connected user within the current room instance.

## Testing Setup

To fully run your local environment, reference instructions within the `walkthrough.md`.
