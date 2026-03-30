# WebSocket Infrastructure — Walkthrough

## What Was Built

Person 1 completed the WebSocket foundation and Person 2 implemented the Webhook ingestion and real-time collaboration frontend. 

### Backend Changes
- **Migration `004_add_webhook_id.sql`**: Added the `webhook_id` column to the `connected_repos` table to properly track GitHub Webhook IDs.
- **`admin.routes.ts`**: The "Add Repo" endpoint now automatically registers a `POST https://api.github.com/repos/{owner}/{repo}/hooks` using the Admin's JWT token and stores the `webhook_id`.
- **`webhook.routes.ts`**: 
  - Validates incoming `X-Hub-Signature-256` HMAC via `GITHUB_WEBHOOK_SECRET`.
  - Supports `application/json` and `application/x-www-form-urlencoded` formats (thanks to `@fastify/formbody`).
  - Broadcasts `remote_push` messages directly through `broadcastToRoom` to active sockets when a push occurs.
- **`ws.plugin.ts`**:
  - Handles WebSocket connections with JWT authentication.
  - Expects `join_room` messages explicitly supplying `repoId`, `branch`, and `filePath` to compute the correct room identifiers.

### Frontend Changes
- **`useCollabSocket.ts`**: Native WebSocket hook that parses the JWT token, controls connection lifecycle (with auto-reconnect backoff), and forwards messages to the Zustand store.
- **`useRoom.ts`**: Handles room presence logic (joins on mount, leaves on unmount/file switch) by sending explicit `{ repoId, branch, filePath }` mappings.
- **`IDE.tsx`**: Uses hooks to bind components. Securely catches `collab:remote_push` to display banners when collaborators commit changes.
- **`collabStore.ts`**: Tracks active peers (`setPeers`, `peerJoined`, `peerLeft`) and *accumulates* incoming diffs via `peerDiff`.
- **`PeerDiffGutter.tsx`**: Responsible purely for rendering side-effects onto the Monaco Editor. Leverages `editor.createDecorationsCollection` to map DiffPatches into line decorations indicating what code peers added, modified, or removed, fully equipped with Monaco hover summaries.

## How to Test and Run the Application Locally

For webhooks to route successfully to your localhost environment, GitHub requires an internet-accessible domain. This documentation outlines using [ngrok](https://ngrok.com/).

### 1. Database Configuration
Run your Postgres Docker instance, and apply all migrations to construct the webhooks configurations:
```bash
docker compose exec -T db psql -U postgres -d collabide -f server/src/db/migrations/003_webhooks.sql
docker compose exec -T db psql -U postgres -d collabide -f server/src/db/migrations/004_add_webhook_id.sql
```

### 2. Set Up Webhook Proxy
Run a local ngrok wrapper mapped to the backend server (e.g., Port 3001 depending on your local config):
```bash
ngrok http 3001
```
This grants a forwarding address (e.g., `https://abcdef.ngrok-free.app`).

### 3. Server Environment Config
In `server/.env`, ensure you define the following secrets:
```env
WEBHOOK_TARGET_URL=https://abcdef.ngrok-free.app/webhooks/github
GITHUB_WEBHOOK_SECRET=your_super_secret_hmac_string
```
*Note: Make sure your ngrok address exactly matches the `ngrok http` address running locally.*

### 4. Running the Complete App
```bash
# In terminal 1
cd server && npm run dev

# In terminal 2
cd client && npm run dev
```

### 5. Testing the Integration
1. Visit the `localhost:5173` dashboard.
2. Under "Add New Repository", link any repo. The backend will use `WEBHOOK_TARGET_URL` to automatically register the hook within the GitHub settings interface.
3. Open `IDE` on this repo via browser. Copy your client URL to a second incognito window/browser and login as a secondary "user".
4. **Validation (Presence)**: Both users should observe the colored Presence Dots in the UI when opening the same file.
5. **Validation (Live Diffs)**: In Window A, type into any file. Hovering the mouse over the highlighted code sections in Window B will reveal a comprehensive markdown tooltip specifying exactly what code Window A added/modified.
6. **Validation (Push Events)**: `git push` a code ref from your exact machine terminal. Both Window A and B event logs will display the push update securely delivered via Github Webhooks.
