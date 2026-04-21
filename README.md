# CollabIDE — Real-Time Collaborative Code Editor

> **Person C Contribution** · State Layer Engineering  
> Owner: Person C — Harshita Jain
> Layer: Redis State Layer (L1/L2/L3)  
> Status: Pipeline Integrated · Latency Fixed · Conflict Engine Implemented

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Module Map](#module-map)
- [Cache Architecture — L1/L2/L3](#cache-architecture--l1l2l3)
- [Diff Storage — Hash + Pipeline Refactor](#diff-storage--hash--pipeline-refactor)
- [Conflict Resolution Engine](#conflict-resolution-engine)
- [Live Presence System](#live-presence-system)
- [UI Components](#ui-components)
- [Tech Stack](#tech-stack)
- [Setup & Running](#setup--running)
- [Environment Variables](#environment-variables)

---

## Architecture Overview

The system is a real-time collaborative IDE with three architectural layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (React + Monaco)                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ FileTree │  │CollabEditor│ │PeerDiff  │  │ConflictPanel │  │
│  │(presence)│  │ (Monaco)   │ │ Window   │  │(3-way merge) │  │
│  └────┬─────┘  └────┬──────┘  └────┬─────┘  └──────┬───────┘  │
│       └──────────────┼─────────────┼────────────────┘          │
│                      │ WebSocket   │                            │
└──────────────────────┼─────────────┼────────────────────────────┘
                       │             │
┌──────────────────────┼─────────────┼────────────────────────────┐
│                SERVER (Fastify + ws)                            │
│  ┌───────────────────┴─────────────┴──────────────────────────┐│
│  │                 messageHandler.ts                          ││
│  │  join_room │ diff_update │ leave_room │ resolve_conflict   ││
│  └─────┬──────────┬──────────────┬──────────────┬─────────────┘│
│        │          │              │              │               │
│  ┌─────▼──┐  ┌────▼─────┐  ┌────▼──────┐  ┌───▼────────────┐ │
│  │presence│  │diffStore │  │pubsub.ts  │  │conflictEngine │  │
│  │Store   │  │(Redis    │  │(PubSub    │  │(classify +     │  │
│  │(Sets)  │  │ Hash D3) │  │ fan-out)  │  │ auto-merge)    │  │
│  └────────┘  └──────────┘  └───────────┘  └────────────────┘  │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              cacheManager.ts (L1 → L2 → L3)            │   │
│  │  ┌─────────┐    ┌──────────┐    ┌───────────────────┐  │   │
│  │  │ LRU L1  │───▶│ Redis L2 │───▶│ GitHub API L3     │  │   │
│  │  │(~μs)    │    │(~1ms)    │    │(~200-600ms)       │  │   │
│  │  └─────────┘    └──────────┘    └───────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

---

## Module Map

All state layer code lives in `server/src/state/`. This is the core of the system — the transport layer and frontend both depend on it.

| Module | Responsibility |
|--------|----------------|
| `redis.client.ts` | Two separate Redis connections: one for commands (master), one for PubSub. Redis requires a dedicated connection for subscribe mode |
| `lru.ts` | Manual LRU implementation. Doubly-linked list + HashMap for O(1) get/put. Serves as L1 in-process memory cache |
| `cacheManager.ts` | Three-tier cache orchestration: L1 → L2 → L3 with read-through pattern |
| `diffStore.ts` | D3 diff storage using Redis Hashes. Single `HSET`/`HGETALL` per file for O(1) reads |
| `presenceStore.ts` | Redis Sets for room membership. SADD/SREM/SMEMBERS with 5-min TTL safety net |
| `pubsub.ts` | Redis Pub/Sub for cross-process event relay. Enables horizontal scaling |
| `conflictEngine.ts` | Three-class conflict classification: Adjacent, Parallel Insert, True Conflict |
| `conflictStore.ts` | Redis persistence for conflict state and resolution history |
| `mergeUtils.ts` | Pure utility functions for line-range math and three-way diff construction |

---

## Cache Architecture — L1/L2/L3

### Why Three Tiers?

Every file open triggers a content fetch. Without caching, every open = GitHub API call (~400ms). With L1/L2/L3:

```
File Open Latency:
  L1 hit (in-memory LRU): ~1μs    ← same process, same machine
  L2 hit (Redis base):     ~1ms    ← shared across server instances
  L3 miss (GitHub API):    ~400ms  ← external network call
```

### Cache Waterfall

```
                    FILE OPEN REQUEST
                          │
                          ▼
                ┌─────────────────────┐
                │   L1: LRU Cache     │  O(1) HashMap + Doubly-Linked List
                │   (lru.ts)          │  Capacity: configurable
                │   ~microsecond      │
                └─────────┬───────────┘
              HIT ◄───────┤ MISS
                          ▼
                ┌─────────────────────┐
                │   L2: Redis D2      │  String key: base:{roomId}
                │   (cacheManager.ts) │  Shared across all server instances
                │   ~1ms              │
                └─────────┬───────────┘
              HIT ◄───────┤ MISS
                          ▼
                ┌─────────────────────┐
                │   L3: GitHub API    │  Octokit GET /repos/.../contents
                │   (cacheManager.ts) │  Writes back to L1 + L2
                │   ~200-600ms        │
                └─────────────────────┘
```

### LRU Algorithm

The L1 cache (`lru.ts`) is a manual implementation — no npm library. It uses a doubly-linked list with sentinel nodes for O(1) operations:

```
Sentinel Head ←→ [MRU Node] ←→ [...] ←→ [LRU Node] ←→ Sentinel Tail

GET(key):
  1. HashMap lookup → O(1)
  2. Unlink node from current position
  3. Reattach at head (most-recently-used)
  4. Return value

SET(key, value):
  1. If key exists: update value, move to head
  2. If at capacity: evict tail (LRU), delete from HashMap
  3. Create new node, attach at head, add to HashMap

DELETE(key):
  1. HashMap lookup → O(1)
  2. Unlink node → O(1)
  3. Delete from HashMap → O(1)

All operations: O(1) time, O(n) space
```

### Why This Matters

Without LRU, Redis handles everything. But Redis is shared — under load with 50 concurrent editors, Redis becomes the bottleneck. L1 absorbs repeated reads for the same file within a single server process, reducing Redis load by ~80% in typical usage.

---

## Diff Storage — Hash + Pipeline Refactor

### The Problem (Before)

The original `diffStore.ts` stored diffs as individual string keys:

```
BEFORE:
  Key: diff:{repo}:{branch}:{file}:{userId}   ← one key per user
  
  To get all diffs:
    1. KEYS diff:{repo}:{branch}:{file}:*      ← O(N) keyspace scan
    2. GET each key individually                ← N round trips
    3. Total: 1 + N Redis commands per keystroke
```

With 10 users editing one file, every keystroke triggers 11 Redis commands. This is the root cause of the latency.

### The Fix (After)

A single Redis Hash per file replaces N string keys:

```
AFTER:
  Key: diffs:{repo}:{branch}:{file}            ← one Hash per file
  Fields: userId → JSON { patches, seq, content }
  
  To get all diffs:
    1. HGETALL diffs:{repo}:{branch}:{file}     ← 1 command, all users
    2. Total: 1 Redis command per keystroke
```

### Pipeline Execution

The write + broadcast is pipelined into a single round trip:

```
const pipeline = redis.pipeline()
pipeline.hset(diffKey, userId, JSON.stringify(delta))  // write diff
pipeline.expire(diffKey, 60)                           // TTL refresh
await pipeline.exec()
// Then publish via separate pubsub command
await pubsub.publish(roomId, diffMsg)
```

### Schema Summary

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `diffs:{roomId}` | Hash | Active diffs. Field = userId, Value = JSON. TTL: 60s |
| `presence:{roomId}` | Set | Room members. Members = userIds. TTL: 5min |
| `base:{roomId}` | String | Committed file content from L2 cache |
| `conflict:{roomId}` | Hash | Active unresolved conflicts. TTL: 30min |
| `resolution_history:{roomId}` | Hash | Resolution decisions. TTL: 2h |

---

## Conflict Resolution Engine

### Why It's Necessary

Without conflict classification, **every** overlapping edit is flagged as a conflict — even when two users edit different parts of the same file. This creates alert fatigue:

```
BEFORE (no classification):
  User A edits line 5     ──┐
  User B edits line 42    ──┤──→ "CONFLICT!" ← false alarm
  User A edits line 10    ──┤──→ "CONFLICT!" ← false alarm  
  User B edits line 10    ──┘──→ "CONFLICT!" ← real conflict

  Result: 3 alerts, only 1 is real. Users stop paying attention.
```

```
AFTER (three-class classification):
  User A edits line 5     ──┐
  User B edits line 42    ──┤──→ ADJACENT: auto-merge silently ✓
  User A edits line 10    ──┤
  User B edits line 10    ──┘──→ TRUE_CONFLICT: show 3-way preview ⚠

  Result: 1 alert, and it's real. Users trust the system.
```

### Three-Class Classification Algorithm

```
classifyConflict(baseContent, diffA, diffB):

  // Step 1: Extract affected line ranges
  rangeA = getAffectedLines(diffA.patches)    // e.g. [2, 3]
  rangeB = getAffectedLines(diffB.patches)    // e.g. [5, 6]

  // Step 2: Compute intersection
  overlap = intersection(rangeA, rangeB)       // e.g. []

  // Step 3: No overlap → Class 1 (ADJACENT)
  if overlap is empty:
    return { type: 'ADJACENT', action: 'AUTO_MERGE' }

  // Step 4: Both insert-only → Class 2 (PARALLEL_INSERT)
  if overlap exists AND isInsertOnly(diffA) AND isInsertOnly(diffB):
    order = deterministicOrder(diffA.userId, diffB.userId)
    return { type: 'PARALLEL_INSERT', action: 'DETERMINISTIC_MERGE', order }

  // Step 5: Overlapping modifications → Class 3 (TRUE_CONFLICT)
  if overlap exists AND either modifies existing content:
    preview = buildThreeWayPreview(base, diffA.content, diffB.content, overlap)
    return { type: 'TRUE_CONFLICT', action: 'FLAG', preview }
```

### Class 1 — Adjacent Edits (Auto-Merge)

Both users edited different line ranges. No conflict. Merge silently.

```
Base:    [L1, L2, L3, L4, L5, L6, L7, L8]
User A:  modified L2, L3          ← lines 2-3
User B:  modified L5, L6          ← lines 5-6
Overlap: intersection([2,3], [5,6]) = []

Result:  ADJACENT — apply both deltas, no flag, no alert.
```

### Class 2 — Parallel Inserts (Deterministic Merge)

Both users inserted at the same position. No conflict of intent — both additions are valid. Order by userId for consistency.

```
Base:    [..., L5, L6, ...]
User A:  inserted 'function validateToken()' after L5
User B:  inserted 'function parseHeader()' after L5

Result:  PARALLEL_INSERT — merge both, order by userId.
Output:  [..., L5, 'function parseHeader()', 'function validateToken()', L6, ...]
```

### Class 3 — True Conflict (Flag + Three-Way Preview)

Both users modified the same line(s) with different content. Cannot be auto-merged. Show the user a structured resolution panel:

```
╔══════════════════════════════════════════════════════╗
║  CONFLICT — Line 42                                  ║
╠══════════════════════════════════════════════════════╣
║  Base (committed)     │ const timeout = 5000         ║
║  Your change (blue)   │ const timeout = 3000         ║
║  Peer change (orange) │ const timeout = 10000        ║
╠══════════════════════════════════════════════════════╣
║  [ Keep Mine ]  [ Keep Theirs ]  [ Edit Manually ]   ║
╚══════════════════════════════════════════════════════╝
```

Resolution is persisted in Redis (`conflict:{roomId}`) and broadcast via PubSub so all peers see the resolution in real-time.

### Conflict Data Flow

```
User A types on line 42
       │
       ▼
  messageHandler.ts receives diff_update
       │
       ├──→ diffStore.setDiff()      stores in Redis Hash
       ├──→ pubsub.publish()         fans out to all instances
       │
       ▼
  conflictEngine.classifyConflict()
       │
       ├── ADJACENT?        → autoMerge() silently
       ├── PARALLEL_INSERT? → deterministicMerge()
       └── TRUE_CONFLICT?   → conflictStore.setConflict()
                              → pubsub.publish('conflict_detected')
                              → all clients show ConflictPanel
```

---

## Live Presence System

### How Presence Works

```
User opens file
       │
       ▼
  presenceStore.join(roomId, userId)
       │
       ├── SADD presence:{roomId} {userId}     ← idempotent
       ├── EXPIRE presence:{roomId} 300        ← 5-min TTL safety net
       │
       ▼
  pubsub.publish('peer_joined')
       │
       ▼
  All clients update PresenceBar + FileTree badges
```

### Stale Presence Detection

If a user's WebSocket drops without a clean disconnect, their presence lingers until the 5-minute TTL expires. To prevent phantom avatars:

1. **Server-side**: TTL on presence sets auto-cleans after 5 minutes
2. **Client-side**: PresenceBar greys out avatars after 15 seconds of no diff activity from that peer

```
Active peer:    [HA] ← coloured ring, full opacity
Stale peer:     [HA] ← grey ring, 45% opacity, "(idle)" tooltip
                 └── grey dot indicator
```

### File Tree Presence Badges

The FileTree component shows live presence on each file:

```
├── src/
│   ├── auth/
│   │   └── login.ts      [HA] [RD]     ← 2 editors active
│   ├── utils/                •          ← rollup dot (someone inside)
│   │   └── helpers.ts     [HA]
│   └── index.ts                   ⚠    ← conflict badge
```

- **Presence badges**: 20px avatar circles with user colour, max 3 shown + overflow "+N"
- **Conflict badges**: Red circle with "!" that pulses on detection
- **Directory rollups**: Blue dot when any descendant has presence

---

## UI Components

### ConflictPanel (`components/ConflictPanel.tsx`)

Floating three-way merge panel that appears when TRUE_CONFLICT is detected. Shows base, your change, and peer change for each conflicting line with resolution buttons.

### PeerDiffWindow (`components/PeerDiffWindow.tsx`)

Side-by-side diff view. Left: your editor (editable). Right: peer's content (read-only). Features a designed empty state when waiting for peer content instead of a blank panel.

### PeerDiffGutter (`components/PeerDiffGutter.tsx`)

Monaco decoration manager for peer edit highlights. Optimised with:
- `React.memo` wrapping to prevent unnecessary re-renders
- `patchHash`-based memoization to skip redundant decoration updates
- Extracted pure `buildDecorations` function

### PresenceBar (`components/PresenceBar.tsx`)

Shows collaborator avatars with stale detection. Tracks last activity timestamp per peer and greys out after 15 seconds of inactivity.

### FileTree (`components/FileTree.tsx`)

Recursive file tree with presence avatars, conflict badges, directory rollup dots, and memoized node rendering via `React.memo`.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Node.js + Fastify | Fast, WebSocket-friendly |
| WebSockets | `ws` library | Simple, no overhead |
| Frontend | React | Component model suits editor UI |
| Code Editor | Monaco Editor | VS Code's editor — handles diff views natively |
| Database | PostgreSQL | User profiles, repos, chat messages |
| State Layer | Redis (ioredis) | Shared state across instances, pub/sub |
| L1 Cache | Custom LRU | O(1) in-process memory, zero deps |
| Auth | GitHub OAuth | User identity + repo access in one flow |

---

## Setup & Running

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis server running on `localhost:6379`

### Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd collab_ide

# 2. Server
cd server
cp .env.example .env    # edit DATABASE_URL, GITHUB_CLIENT_ID, etc.
npm install
npm run dev              # starts on port 3000

# 3. Client (new terminal)
cd client
cp .env.example .env    # set VITE_API_URL=http://localhost:3000
npm install
npm run dev              # starts on port 5173
```

### Database Setup

```bash
# Via Docker (recommended)
docker compose up -d db

# Run migrations
docker compose exec -T db psql -U postgres -d collabide -f /dev/stdin < server/src/db/migrations/001_init.sql
docker compose exec -T db psql -U postgres -d collabide -f /dev/stdin < server/src/db/migrations/002_admin_portal.sql
```

### PostgreSQL Password Fix

If you get "password authentication failed":

```sql
ALTER USER postgres WITH PASSWORD 'password';
```

Then update `DATABASE_URL` in `server/.env`.

---

## Environment Variables

### Server (`server/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection string |
| `GITHUB_CLIENT_ID` | Yes | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Yes | — | GitHub OAuth app client secret |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `ENCRYPTION_KEY` | Yes | — | AES-256 key for GitHub token encryption |

### Client (`client/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | Yes | — | Server URL (e.g., `http://localhost:3000`) |

---

## Directory Structure

```
collab_ide/
├── server/
│   └── src/
│       ├── auth/               # GitHub OAuth, JWT, crypto
│       ├── db/                 # PostgreSQL client + migrations
│       ├── middleware/         # requireAuth preHandler
│       ├── routes/             # REST API endpoints
│       ├── services/           # GitHub + token services
│       ├── state/              # ← PERSON C'S LAYER
│       │   ├── redis.client.ts    # dual Redis connections
│       │   ├── lru.ts             # O(1) LRU cache (L1)
│       │   ├── cacheManager.ts    # L1→L2→L3 waterfall
│       │   ├── diffStore.ts       # Redis Hash diff storage (D3)
│       │   ├── presenceStore.ts   # Redis Set room membership
│       │   ├── pubsub.ts          # cross-process event relay
│       │   ├── conflictEngine.ts  # 3-class classification
│       │   ├── conflictStore.ts   # conflict persistence
│       │   └── mergeUtils.ts      # line-range math utilities
│       ├── ws/
│       │   ├── messageHandler.ts  # WS message routing
│       │   ├── roomManager.ts     # room lifecycle
│       │   ├── conflictHandler.ts # conflict resolution handler
│       │   └── ws.types.ts        # message type definitions
│       └── index.ts               # app entry point
│
├── client/
│   └── src/
│       ├── components/
│       │   ├── FileTree.tsx       # presence + conflict badges
│       │   ├── CollabEditor.tsx   # Monaco wrapper
│       │   ├── PeerDiffWindow.tsx # side-by-side diff view
│       │   ├── PeerDiffGutter.tsx # memoised decorations
│       │   ├── PresenceBar.tsx    # stale-aware avatars
│       │   └── ConflictPanel.tsx  # 3-way resolution UI
│       ├── hooks/
│       │   ├── useCollabSocket.ts # WebSocket lifecycle
│       │   └── useRoom.ts        # room join/leave
│       ├── store/
│       │   ├── collabStore.ts     # Zustand peer state
│       │   └── repoStore.ts       # repo/branch selection
│       └── pages/
│           ├── IDE.tsx            # main IDE layout
│           ├── Dashboard.tsx      # repo management
│           └── Login.tsx          # GitHub OAuth
│
├── docker-compose.yml
└── README.md                      # ← you are here
```
