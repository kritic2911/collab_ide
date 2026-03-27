import { useEffect, useMemo, useState } from 'react';
import Shell from '../ui/Shell';
import { colors, cardStyle, buttonBase, buttonPrimary, inputStyle } from '../ui/styles';
import {
  ConnectedRepo,
  GithubRepo,
  Group,
  Role,
  UserSummary,
  connectRepo,
  createGroup,
  createRole,
  disconnectRepo,
  fetchAdminGithubRepos,
  fetchAdminRepos,
  fetchGroups,
  fetchRoles,
  fetchUsers,
  updateRepoAccess,
} from '../api/admin';
import api from '../api/client';

export default function AdminDashboard() {
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [connected, setConnected] = useState<ConnectedRepo[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newRole, setNewRole] = useState('');
  const [newGroupName, setNewGroupName] = useState('');

  const [expandedRoles, setExpandedRoles] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const connectedRepoIds = useMemo(() => new Set(connected.map((r) => Number(r.github_repo_id))), [connected]);

  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [bulkRole, setBulkRole] = useState('');
  const [bulkGroupId, setBulkGroupId] = useState<number | null>(null);

  const assignableRoles = useMemo(
    () => roles.filter((r) => r.name !== 'admin'),
    [roles]
  );

  const onBulkRoleChange = async () => {
    if (!bulkRole || selectedUserIds.length === 0) return;
    setError(null);
    try {
      await Promise.all(selectedUserIds.map((id) =>
        api.put(`/api/admin/users/${id}/role`, { role: bulkRole })
      ));
      setSelectedUserIds([]);
      setBulkRole('');
      const next = await fetchUsers();
      setUsers(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to update roles');
    }
  };

  const onBulkAddToGroup = async () => {
    if (!bulkGroupId || selectedUserIds.length === 0) return;
    setError(null);
    try {
      await Promise.all(selectedUserIds.map((id) =>
        api.post(`/api/admin/groups/${bulkGroupId}/members`, { user_id: id })
      ));
      setSelectedUserIds([]);
      setBulkGroupId(null);
      const next = await fetchGroups();
      setGroups(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to add to group');
    }
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [gh, cr, rs, gs, us] = await Promise.all([
        fetchAdminGithubRepos(),
        fetchAdminRepos(),
        fetchRoles(),
        fetchGroups(),
        fetchUsers(),
      ]);
      setGithubRepos(gh);
      setConnected(cr);
      setRoles(rs);
      setGroups(gs);
      setUsers(us);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const onConnect = async (repo: GithubRepo) => {
    setError(null);
    try {
      const created = await connectRepo(repo);
      setConnected((prev) => [created, ...prev]);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to connect repo');
    }
  };

  const onDisconnect = async (id: number) => {
    setError(null);
    try {
      await disconnectRepo(id);
      setConnected((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to disconnect repo');
    }
  };

  const onUpdateAccess = async (repoId: number, visibility: 'all' | 'restricted', roleIds: number[], groupIds: number[]) => {
    setError(null);
    try {
      await updateRepoAccess(repoId, visibility, roleIds, groupIds);
      const next = await fetchAdminRepos();
      setConnected(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to update access');
    }
  };

  const onCreateRole = async () => {
    const name = newRole.trim();
    if (!name) return;
    setError(null);
    try {
      const r = await createRole(name);
      setRoles((prev) => [...prev, r]);
      setNewRole('');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to create role');
    }
  };

  const onDeleteRole = async (roleId: number) => {
    setError(null);
    try {
      await api.delete(`/api/admin/roles/${roleId}`);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      setExpandedRoles((prev) => { const s = new Set(prev); s.delete(roleId); return s; });
      const next = await fetchUsers();
      setUsers(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to delete role');
    }
  };

  const onRemoveFromRole = async (userId: number) => {
    setError(null);
    try {
      await api.put(`/api/admin/users/${userId}/role`, { role: 'user' });
      const next = await fetchUsers();
      setUsers(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to remove user from role');
    }
  };

  const onCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setError(null);
    try {
      await createGroup(name, []);
      setNewGroupName('');
      const next = await fetchGroups();
      setGroups(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to create group');
    }
  };

  const onRemoveFromGroup = async (groupId: number, userId: number) => {
    setError(null);
    try {
      await api.delete(`/api/admin/groups/${groupId}/members/${userId}`);
      const next = await fetchGroups();
      setGroups(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to remove member');
    }
  };

  const onDeleteGroup = async (groupId: number) => {
    setError(null);
    try {
      await api.delete(`/api/admin/groups/${groupId}`);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setExpandedGroups((prev) => { const s = new Set(prev); s.delete(groupId); return s; });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to delete group');
    }
  };

  const toggleRole = (id: number) =>
    setExpandedRoles((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleGroup = (id: number) =>
    setExpandedGroups((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const usersForRole = (roleId: number) => {
    const roleName = roles.find((r) => r.id === roleId)?.name;
    return users.filter((u) => u.role === roleName);
  };

  const usersForGroup = (groupId: number) => {
    const group = groups.find((g) => g.id === groupId);
    const memberIds = new Set((group?.members ?? []).map((m) => m.user_id));
    return users.filter((u) => memberIds.has(u.id));
  };

  return (
    <Shell title="Admin">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>Admin dashboard</div>
          <div style={{ marginTop: 4, color: colors.muted, fontSize: 13 }}>
            Connect repos, manage roles/groups, and restrict access.
          </div>
        </div>
        <button onClick={loadAll} style={{ ...buttonBase, fontSize: 13 }} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 10,
          border: '1px solid rgba(248, 81, 73, 0.4)',
          background: 'rgba(248, 81, 73, 0.08)',
          color: colors.danger, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Row 1: GitHub repos + Connected repos ── */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>GitHub repos (connect)</div>
          <div style={{ marginTop: 6, color: colors.muted, fontSize: 13 }}>
            Pulled from the admin's GitHub account.
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {githubRepos.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>No repos found (or token missing).</div>
            ) : (
              githubRepos.slice(0, 30).map((r) => {
                const already = connectedRepoIds.has(Number(r.id));
                return (
                  <div key={r.id} style={{
                    border: `1px solid ${colors.border}`, borderRadius: 12,
                    padding: '10px 12px', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 10,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.full_name}
                      </div>
                      <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                        Default: {r.default_branch} • {r.private ? 'Private' : 'Public'}
                      </div>
                    </div>
                    <button
                      disabled={already}
                      onClick={() => onConnect(r)}
                      style={{ ...(already ? buttonBase : buttonPrimary), opacity: already ? 0.6 : 1, fontSize: 13, whiteSpace: 'nowrap' }}
                    >
                      {already ? 'Connected' : 'Connect'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Connected repos (access)</div>
          <div style={{ marginTop: 6, color: colors.muted, fontSize: 13 }}>
            Set "restricted" and pick roles/groups.
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {connected.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>No connected repos yet.</div>
            ) : (
              connected.map((r) => (
                <RepoAccessCard key={r.id} repo={r} roles={roles} groups={groups}
                  onDisconnect={() => onDisconnect(r.id)} onSave={onUpdateAccess} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Users + Roles ── */}
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Users */}
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Users</div>
          <div style={{ marginTop: 4, color: colors.muted, fontSize: 13 }}>
            Select users to assign a role or add to a group.
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {users.map((u) => {
              const checked = selectedUserIds.includes(u.id);
              const initials = u.username.slice(0, 2).toUpperCase();
              return (
                <label key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  border: `1px solid ${checked ? colors.brandA : colors.border}`,
                  cursor: 'pointer', background: checked ? 'rgba(88,166,255,0.06)' : 'transparent',
                }}>
                  <input type="checkbox" checked={checked} onChange={() =>
                    setSelectedUserIds((prev) =>
                      prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                    )
                  } />
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: colors.bg2, border: `1px solid ${colors.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: colors.brandA, flexShrink: 0,
                  }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{u.username}</div>
                    <div style={{ color: colors.muted, fontSize: 12 }}>{u.role}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {selectedUserIds.length > 0 && (
            <div style={{
              marginTop: 12, paddingTop: 12,
              borderTop: `1px solid ${colors.border}`,
              display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}>
                <option value="">Change role to…</option>
                <option value="user">user</option>
                {assignableRoles.filter((r) => r.name !== 'user').map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
              <button onClick={onBulkRoleChange} style={{ ...buttonPrimary, fontSize: 13 }}>Apply role</button>
              <select value={bulkGroupId ?? ''} onChange={(e) => setBulkGroupId(Number(e.target.value) || null)}
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}>
                <option value="">Add to group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button onClick={onBulkAddToGroup} style={{ ...buttonPrimary, fontSize: 13 }}>Add to group</button>
            </div>
          )}
        </div>

        {/* Roles */}
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Roles</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input value={newRole} onChange={(e) => setNewRole(e.target.value)}
              placeholder="New role name" style={inputStyle}
              onKeyDown={(e) => e.key === 'Enter' && onCreateRole()} />
            <button onClick={onCreateRole} style={{ ...buttonPrimary, whiteSpace: 'nowrap' }}>Add</button>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {roles.filter((r) => r.name !== 'admin').map((r) => {
              const isOpen = expandedRoles.has(r.id);
              const members = usersForRole(r.id);
              const isPredefined = r.is_predefined;
              return (
                <div key={r.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8 }}>
                    <button
                      onClick={() => toggleRole(r.id)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                        background: 'transparent', border: 'none', cursor: 'pointer', color: colors.text, padding: 0,
                      }}
                    >
                      <span style={{ fontSize: 11, color: colors.muted }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</span>
                      <span style={{ color: colors.muted, fontSize: 12 }}>{members.length} users</span>
                      {isPredefined && (
                        <span style={{ color: colors.muted, fontSize: 11, background: colors.bg2, padding: '2px 6px', borderRadius: 6 }}>
                          predefined
                        </span>
                      )}
                    </button>
                    {!isPredefined && (
                      <button
                        onClick={() => onDeleteRole(r.id)}
                        style={{
                          ...buttonBase, fontSize: 12, padding: '4px 10px',
                          color: colors.danger, borderColor: 'rgba(248,81,73,0.3)',
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${colors.border}`, padding: '6px 12px 10px' }}>
                      {members.length === 0 ? (
                        <div style={{ color: colors.muted, fontSize: 13, padding: '4px 0' }}>No users with this role.</div>
                      ) : (
                        members.map((u) => (
                          <div key={u.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 0', borderBottom: `1px solid ${colors.border}`,
                          }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: '50%',
                              background: colors.bg2, border: `1px solid ${colors.border}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 700, color: colors.brandA, flexShrink: 0,
                            }}>
                              {u.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{u.username}</span>
                              <span style={{ color: colors.muted, fontSize: 12, marginLeft: 8 }}>{u.role}</span>
                            </div>
                            {!isPredefined && (
                              <button
                                onClick={() => onRemoveFromRole(u.id)}
                                style={{ ...buttonBase, fontSize: 12, padding: '3px 8px', color: colors.muted }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Row 3: Groups ── */}
      <div style={{ marginTop: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Groups</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New group name" style={inputStyle}
              onKeyDown={(e) => e.key === 'Enter' && onCreateGroup()} />
            <button onClick={onCreateGroup} style={{ ...buttonPrimary, whiteSpace: 'nowrap' }}>Create group</button>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            {groups.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>No groups yet.</div>
            ) : (
              groups.map((g) => {
                const isOpen = expandedGroups.has(g.id);
                const members = usersForGroup(g.id);
                return (
                  <div key={g.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8 }}>
                      <button
                        onClick={() => toggleGroup(g.id)}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                          background: 'transparent', border: 'none', cursor: 'pointer', color: colors.text, padding: 0,
                        }}
                      >
                        <span style={{ fontSize: 11, color: colors.muted }}>{isOpen ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>{g.name}</span>
                        <span style={{ color: colors.muted, fontSize: 12 }}>{members.length} members</span>
                      </button>
                      <button
                        onClick={() => onDeleteGroup(g.id)}
                        style={{
                          ...buttonBase, fontSize: 12, padding: '4px 10px',
                          color: colors.danger, borderColor: 'rgba(248,81,73,0.3)',
                        }}
                      >
                        Delete
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${colors.border}`, padding: '6px 12px 10px' }}>
                        {members.length === 0 ? (
                          <div style={{ color: colors.muted, fontSize: 13, padding: '4px 0' }}>No members.</div>
                        ) : (
                          members.map((u) => (
                            <div key={u.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 0', borderBottom: `1px solid ${colors.border}`,
                            }}>
                              <div style={{
                                width: 26, height: 26, borderRadius: '50%',
                                background: colors.bg2, border: `1px solid ${colors.border}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 700, color: colors.brandA, flexShrink: 0,
                              }}>
                                {u.username.slice(0, 2).toUpperCase()}
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{u.username}</span>
                                <span style={{ color: colors.muted, fontSize: 12, marginLeft: 8 }}>{u.role}</span>
                              </div>
                              <button
                                onClick={() => onRemoveFromGroup(g.id, u.id)}
                                style={{ ...buttonBase, fontSize: 12, padding: '3px 8px', color: colors.muted }}
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function RepoAccessCard({
  repo, roles, groups, onDisconnect, onSave,
}: {
  repo: ConnectedRepo; roles: Role[]; groups: Group[];
  onDisconnect: () => void;
  onSave: (repoId: number, visibility: 'all' | 'restricted', roleIds: number[], groupIds: number[]) => Promise<void>;
}) {
  const initialRoleIds = useMemo(() => {
    const s = new Set<number>();
    (repo.access_rules ?? []).forEach((a) => { if (a.role_id) s.add(a.role_id); });
    return Array.from(s);
  }, [repo.access_rules]);

  const initialGroupIds = useMemo(() => {
    const s = new Set<number>();
    (repo.access_rules ?? []).forEach((a) => { if (a.group_id) s.add(a.group_id); });
    return Array.from(s);
  }, [repo.access_rules]);

  const [visibility, setVisibility] = useState<'all' | 'restricted'>(repo.visibility ?? 'all');
  const [roleIds, setRoleIds] = useState<number[]>(initialRoleIds);
  const [groupIds, setGroupIds] = useState<number[]>(initialGroupIds);
  const [saving, setSaving] = useState(false);

  const dirty =
    visibility !== (repo.visibility ?? 'all') ||
    roleIds.slice().sort().join(',') !== initialRoleIds.slice().sort().join(',') ||
    groupIds.slice().sort().join(',') !== initialGroupIds.slice().sort().join(',');

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {repo.owner}/{repo.name}
          </div>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Default: {repo.default_branch}</div>
        </div>
        <button onClick={onDisconnect} style={{ ...buttonBase, fontSize: 13 }}>Disconnect</button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800 }}>Visibility</div>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)} style={inputStyle}>
            <option value="all">all (everyone)</option>
            <option value="restricted">restricted</option>
          </select>
        </div>

        {visibility === 'restricted' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MultiSelect
              label="Roles"
              options={roles.filter((r) => r.name !== 'admin').map((r) => ({ id: r.id, label: r.name }))}
              selected={roleIds} onChange={setRoleIds}
            />
            <MultiSelect
              label="Groups"
              options={groups.map((g) => ({ id: g.id, label: g.name }))}
              selected={groupIds} onChange={setGroupIds}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            disabled={!dirty || saving}
            onClick={async () => { setSaving(true); try { await onSave(repo.id, visibility, roleIds, groupIds); } finally { setSaving(false); } }}
            style={{ ...(dirty ? buttonPrimary : buttonBase), opacity: !dirty || saving ? 0.6 : 1, fontSize: 13 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: { id: number; label: string }[];
  selected: number[]; onChange: (ids: number[]) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{
        border: `1px solid ${colors.border}`, borderRadius: 12, padding: 10,
        maxHeight: 140, overflow: 'auto', background: 'rgba(13, 17, 23, 0.4)',
      }}>
        {options.length === 0 ? (
          <div style={{ color: colors.muted, fontSize: 13 }}>None</div>
        ) : (
          options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px' }}>
                <input type="checkbox" checked={checked}
                  onChange={() => onChange(checked ? selected.filter((x) => x !== o.id) : [...selected, o.id])} />
                <span style={{ fontWeight: 700 }}>{o.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}