# Admin Portal: Repo Connection & Browsing

Admin connects GitHub repos to CollabIDE. Users browse available repos, pick a branch, browse the file tree, and view file content. Default visibility is "all users"; admin can optionally restrict repos to specific roles/groups (OR logic).

## Proposed Changes

### Database Migration

#### [NEW] [002_admin_portal.sql](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/db/migrations/002_admin_portal.sql)

Six new tables:

| Table | Purpose |
|---|---|
| `connected_repos` | Repos the admin has connected (stores GitHub repo ID, owner, name, default_branch, visibility) |
| `roles` | Predefined + custom roles (name is display-only, all logic uses IDs) |
| `user_roles` | Many-to-many: which users have which roles |
| `groups` | Named collections of users |
| `user_groups` | Many-to-many: which users are in which groups |
| `repo_access` | Which roles/groups can access a restricted repo (OR logic) |

Access rule: if `connected_repos.visibility = 'all'` → everyone sees it. If `'restricted'` → server checks `repo_access` for matching role_id or group_id.

---

#### [NEW] [seedRoles.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/db/seedRoles.ts)

Seeds predefined roles (`admin`, `editor`, `viewer`) on startup, similar to [seedOrgCode.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/db/seedOrgCode.ts).

#### [MODIFY] [index.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/index.ts)

- Import and call `seedRoles()` after [seedOrgCode()](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/db/seedOrgCode.ts#4-30)
- Import and register `adminRoutes`

---

### Admin Middleware

#### [NEW] [requireAdmin.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/middleware/requireAdmin.ts)

Wraps [requireAuth](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/middleware/requireAuth.ts#10-33): first verifies JWT, then checks `role === 'admin'`. Returns 403 if not admin.

---

### Admin API Routes

#### [NEW] [admin.routes.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/routes/admin.routes.ts)

All routes guarded by `requireAdmin`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/github/repos` | Uses admin's stored GitHub token to fetch their repo list from GitHub |
| `POST` | `/api/admin/repos` | Connect a repo — body has `github_repo_id` selected from the list above |
| `DELETE` | `/api/admin/repos/:id` | Disconnect a repo (cascade deletes `repo_access` rows) |
| `GET` | `/api/admin/repos` | List all connected repos with their access settings |
| `POST` | `/api/admin/roles` | Create a custom role (name label + `is_predefined=false`) |
| `GET` | `/api/admin/roles` | List all roles |
| `POST` | `/api/admin/groups` | Create a group with selected user IDs |
| `GET` | `/api/admin/groups` | List all groups with members |
| `GET` | `/api/admin/users` | List all users (for group member selection) |
| `PUT` | `/api/admin/repos/:id/access` | Set visibility + role/group restrictions on a repo |

---

### User Browsing Routes

#### [MODIFY] [repo.routes.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/routes/repo.routes.ts)

All routes guarded by [requireAuth](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/server/src/middleware/requireAuth.ts#10-33).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/repos` | List connected repos visible to the current user (checks access rules) |
| `GET` | `/api/repos/:id/branches` | List branches (fetched from GitHub via admin token) |
| `GET` | `/api/repos/:id/tree` | File tree for `?branch=X` (fetched from GitHub) |
| `GET` | `/api/repos/:id/file` | File content for `?branch=X&path=Y` (fetched from GitHub) |

Key: The server uses the **admin's** GitHub token for all GitHub API calls, not the user's.

---

### Frontend — Admin Dashboard

#### [NEW] [AdminDashboard.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/pages/AdminDashboard.tsx)

- Panel showing GitHub repos available to connect (fetched from `/api/admin/github/repos`)
- List of connected repos with disconnect button
- Per-repo access settings (toggle `all` ↔ `restricted`, pick roles/groups)
- Role management section (list + create custom)
- Group management section (list + create with user selector)

#### [NEW] [admin.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/api/admin.ts)

API client functions for all admin endpoints.

---

### Frontend — User Browse Flow

#### [MODIFY] [Dashboard.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/pages/Dashboard.tsx)

- Fetches `/api/repos` and displays connected repos as cards
- Click a repo → navigate to `/browse/:repoId`

#### [NEW] [RepoBrowser.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/pages/RepoBrowser.tsx)

- Branch selector dropdown (fetched from `/api/repos/:id/branches`)
- File tree sidebar (fetched from `/api/repos/:id/tree?branch=X`)
- Click a file → fetches content from `/api/repos/:id/file?branch=X&path=Y` and displays in a read-only Monaco editor

#### [NEW] [repoStore.ts](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/store/repoStore.ts)

Zustand store: connected repos list, selected repo, selected branch, file tree cache.

#### [MODIFY] [App.tsx](file:///c:/Users/Kriti/OneDrive/Desktop/sem6/btp/collab_ide/client/src/App.tsx)

Add routes: `/admin` (admin only), `/dashboard`, `/browse/:repoId`

---

## Verification Plan

### Manual Verification (Browser)

> [!IMPORTANT]
> No existing test framework is set up in this project. Verification is browser-based.

1. **Start the server and client:**
   ```
   cd server && npm run dev
   cd client && npm run dev
   ```

2. **Run migration:**
   ```
   psql $DATABASE_URL < server/src/db/migrations/002_admin_portal.sql
   ```
   Verify: predefined roles (`admin`, `editor`, `viewer`) appear in `roles` table after server starts.

3. **Admin flow:**
   - Log in as admin (the `ADMIN_GITHUB_USERNAME` user)
   - Navigate to `/admin`
   - Verify: GitHub repos list loads from the admin's account
   - Click "Connect" on a repo → verify it appears in the connected list
   - Verify: `connected_repos` table has a new row

4. **User flow:**
   - Log in as a non-admin user
   - Navigate to `/dashboard`
   - Verify: the connected repo appears in the repo list
   - Click into the repo → verify branches load
   - Select a branch → verify file tree loads
   - Click a file → verify file content displays

5. **Access restriction:**
   - As admin: set a repo to "restricted" and assign it to a specific role
   - As a user WITHOUT that role: navigate to `/dashboard`
   - Verify: the restricted repo does NOT appear in the list
