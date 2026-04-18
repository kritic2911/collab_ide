# Webhooks Architecture & Setup

This document outlines how real-time GitHub Webhooks are implemented in CollabIDE and provides instructions for setting up testing environments across multiple developers.

## The Problem: Webhooks in a Local Dev Environment

GitHub sends webhooks to a public URL. Since CollabIDE runs locally during development, GitHub cannot reach `localhost:3000`. 
Therefore, an **Ngrok tunnel** is required to expose the local server to the internet.

When multiple developers are testing on the same GitHub repository, **they CANNOT use the same webhook configuration**. If Dev A uses their Ngrok URL in the central webhook, Dev B will receive no events. 

### Best Practice for Team Collaboration:
**Every developer must create their own webhook on the shared GitHub repository pointing to their own personal Ngrok URL.**

---

## 🛠️ Developer Setup Instructions

Follow these exact steps to receive live GitHub pushes in your local CollabIDE instance:

### 1. Start your local tunnel
Install Ngrok and expose your server port (default `3000`):
```bash
ngrok http 3000
```
*Note your Forwarding URL (e.g., `https://abcdef123.ngrok-free.app`). Leave this terminal running.*

### 2. Configure your secret
Create a random strong secret string (e.g., a UUID or long string).
In `server/.env`, set:
```env
GITHUB_WEBHOOK_SECRET=your_super_secret_string_here
```
*Restart your node server (`npm run dev`) so it picks up the new secret.*

### 3. Add YOUR Webhook to GitHub
1. Go to the GitHub Repository on GitHub.com.
2. Navigate to **Settings → Webhooks → Add webhook**.
3. **Payload URL:** Paste your Ngrok URL and append `/webhooks/github`.
   *(Example: `https://abcdef123.ngrok-free.app/webhooks/github`)*
4. **Content type:** Select `application/json` (CollabIDE handles both JSON and URL-encoded, but JSON is preferred).
5. **Secret:** Paste the exact `GITHUB_WEBHOOK_SECRET` you set in step 2.
6. **Which events?** Choose **"Send me everything"** or select **"Pushes"**.
7. Click **Add webhook**.

> **Note:** GitHub will send an initial `ping` event. You should see a 200 OK in your ngrok terminal, and the Ping event will be logged in `server/webhooks.log`.

---

## 🏗️ Architecture & Implementation

CollabIDE uses a resilient, horizontally scalable architecture for processing incoming webhooks.

### 1. Payload Parsing & Security (The Entry Point)
**Code:** `server/src/routes/webhook.routes.ts`

When a POST request hits `/webhooks/github`, Fastify processes it.
1. **Raw Body Capture**: We use a custom Fastify `addContentTypeParser` to capture the *exact raw Buffer string* before converting it to JSON. This is critical.
2. **HMAC-SHA256 Verification**: GitHub secures webhooks by calculating an HMAC hex digest of the raw body using your secret, sending it in the `X-Hub-Signature-256` header.
3. We recalculate the hash using the captured raw body and `GITHUB_WEBHOOK_SECRET`. 
4. We use `crypto.timingSafeEqual()` to compare signatures, preventing timing attacks. 

> *If verification fails, the server responds with 401 Unauthorized.*

### 2. Persistence Layer
Once verified, the payload is mapped to a connected repository in the database (`connected_repos` table via the `github_repo_id`).
The event is then permanently stored in the `webhook_events` table. 
* This allows users to view a historical log of all webhooks when they open the IDE, fetched via the REST endpoint `GET /api/repos/:repoId/events`.

### 3. Real-time PubSub Distribution
Webhooks represent **branch-wide events**. If someone pushes to `main`, anyone viewing *any* file on `main` should be notified.

1. The webhook handler extracts the branch and changed files from the payload.
2. It calls `publishGlobalWebhook()` from `server/src/state/pubsub.ts`.
3. The event is published to the Redis channel `global:webhook_pushes`.

**Why Redis PubSub?** 
If the backend is scaled horizontally (e.g., 5 Node.js instances behind a load balancer), the webhook HTTP request only hits *one* instance. Redis broadcasts the event to *all 5 instances*, ensuring every connected client gets the notification regardless of which load-balancer node they are connected to.

### 4. WebSocket Broadcast
**Code:** `server/src/ws/roomManager.ts` & `server/src/index.ts`

1. Upon scaling/boot, every backend instance subscribes to `global:webhook_pushes` (in `index.ts`).
2. When a push event arrives via Redis, the instance executes `broadcastToBranch()`.
3. `broadcastToBranch()` iterates over all local WebSockets. Any socket whose active room starts with `${repoId}:${branch}:` receives the `remote_push` WebSocket message.

### 5. Client Consumption & UI
**Code:** `client/src/pages/IDE.tsx` & `client/src/hooks/useCollabSocket.ts`

1. The React hook `useCollabSocket` receives the `remote_push` packet.
2. It dispatches a native browser `CustomEvent` (`collab:remote_push`).
3. `IDE.tsx` listens for this event. 
4. Upon triggering, it mounts a high-visibility banner: `"[Username] pushed [file] — your diff may now conflict."` 
5. It also synthetically updates the `WebhookLog.tsx` UI widget to show the event instantly without a page refresh or REST call.

---

## 📊 File Logging 

For deeper auditing without touching PostgreSQL, backend logging runs natively:
* `server/webhooks.log`: A dedicated append-only file tracking webhook receipts, signature verification results, repo matching, error catches, and broadcast socket counts.
* `server/server.log`: A master log where all webhook logs are mirrored (prefixed with `[WEBHOOK]`) alongside general server startups, errors, and chat cleanups.
