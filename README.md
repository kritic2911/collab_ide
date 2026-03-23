# collab_ide

## Tech Stack
| Layer | Use | Why| 
|---|---|---|
|Backend|Node.js + Fastify| Fast, WebSocket-friendly, everyone knows JS|
| WebSockets |ws library or Fastify's built-in | Simple, no overhead |
|Frontend| React| Component model suits editor UI|
|Code Editor|Monaco Editor (React wrapper)|This is VS Code's editor — don't build your own, it handles diff views natively|
|Database|PostgreSQL only|Need to handle only user profiles, connected repos, chat messages|
|In-memory state|Plain JS Maps|Replaces Redis for MVP|
|Auth|GitHub OAuth via Passport.js|Gives you user identity + repo access in one flow|

## Database
### Basic tables needed
**users:**
>  `id, github_id, username, avatar_url, 
  color_hex, github_token (encrypted), created_at`

**repositories:**
>  `id, github_repo_id, owner_id, name, 
  full_name, webhook_id, created_at`

**chat_messages:**
> `id, repo_id, branch, filepath, 
  author_id, content, line_pin_start, 
  line_pin_end, created_at`

