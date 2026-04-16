import api from './client.js';

/* ─── Types ─── */
export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

export interface ConnectedRepo {
  id: number;
  github_repo_id: number;
  owner: string;
  name: string;
  default_branch: string;
  visibility: 'all' | 'restricted';
  connected_at: string;
  access_rules?: { role_id: number | null; group_id: number | null }[];
}

export interface Role {
  id: number;
  name: string;
  is_predefined: boolean;
}

export interface Group {
  id: number;
  name: string;
  members: { user_id: number }[];
}

export interface UserSummary {
  id: number;
  username: string;
  avatar_url: string;
  role: string;
}

/* ─── Admin: GitHub repos ─── */
export const fetchAdminGithubRepos = () =>
  api.get<GithubRepo[]>('/api/admin/github/repos').then(r => r.data);

/* ─── Admin: Connected repos ─── */
export const fetchAdminRepos = () =>
  api.get<ConnectedRepo[]>('/api/admin/repos').then(r => r.data);

export const connectRepo = (repo: GithubRepo) =>
  api.post<ConnectedRepo>('/api/admin/repos', {
    github_repo_id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    default_branch: repo.default_branch,
  }).then(r => r.data);

export const disconnectRepo = (id: number) =>
  api.delete(`/api/admin/repos/${id}`).then(r => r.data);

export const updateRepoAccess = (
  id: number,
  visibility: 'all' | 'restricted',
  role_ids: number[] = [],
  group_ids: number[] = []
) =>
  api.put(`/api/admin/repos/${id}/access`, { visibility, role_ids, group_ids }).then(r => r.data);

/* ─── Admin: Roles ─── */
export const fetchRoles = () =>
  api.get<Role[]>('/api/admin/roles').then(r => r.data);

export const createRole = (name: string) =>
  api.post<Role>('/api/admin/roles', { name }).then(r => r.data);

/* ─── Admin: Groups ─── */
export const fetchGroups = () =>
  api.get<Group[]>('/api/admin/groups').then(r => r.data);

export const createGroup = (name: string, user_ids: number[] = []) =>
  api.post<Group>('/api/admin/groups', { name, user_ids }).then(r => r.data);

/* ─── Admin: Users ─── */
export const fetchUsers = () =>
  api.get<UserSummary[]>('/api/admin/users').then(r => r.data);

/** Shape of a snapshot response from /api/repos/:id/snapshot */
export interface BranchSnapshot {
  /** True if the response was served from the server-side cache */
  cached: boolean;
  /** How old the cached entry is in ms (only present when cached=true) */
  ageMs?: number;
  /** Number of file contents already in the cache (only present when cached=true) */
  fileCount?: number;
  /** Flat git-tree items for this branch */
  tree: { path: string; type: string }[];
}

/* ─── User: browsing ─── */
export const fetchRepos = () =>
  api.get<ConnectedRepo[]>('/api/repos').then(r => r.data);

/** Returns branch names converted to objects for the UI */
export const fetchBranches = (repoId: number) =>
  api.get<string[]>(`/api/repos/${repoId}/branches`).then(r => r.data.map(name => ({ name })));

/**
 * Fetch (or retrieve from server cache) the committed file tree for a branch.
 * This seeds the branch-base snapshot used by the collaborative editor.
 */
export const fetchSnapshot = (repoId: number, branch: string) =>
  api.get<BranchSnapshot>(
    `/api/repos/${repoId}/snapshot`, { params: { branch } }
  ).then(r => r.data);

/** Backwards-compat: raw tree without snapshot metadata */
export const fetchFileTree = (repoId: number, branch: string) =>
  api.get<{ path: string; type: string }[]>(
    `/api/repos/${repoId}/tree`, { params: { branch } }
  ).then(r => r.data);

export const fetchFileContent = (repoId: number, branch: string, path: string) =>
  api.get<{ content: string; cached: boolean }>(
    `/api/repos/${repoId}/file`, { params: { branch, path } }
  ).then(r => r.data);
