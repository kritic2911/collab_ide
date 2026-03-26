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
  const [newGroupUserIds, setNewGroupUserIds] = useState<number[]>([]);

  const connectedRepoIds = useMemo(() => new Set(connected.map((r) => r.github_repo_id)), [connected]);

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

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Refresh that repo row with server-computed access_rules
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
      setRoles((prev) => [r, ...prev]);
      setNewRole('');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to create role');
    }
  };

  const onCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setError(null);
    try {
      const g = await createGroup(name, newGroupUserIds);
      setGroups((prev) => [g, ...prev]);
      setNewGroupName('');
      setNewGroupUserIds([]);
      // refresh groups list to include members aggregation
      const next = await fetchGroups();
      setGroups(next);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to create group');
    }
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
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(248, 81, 73, 0.4)',
            background: 'rgba(248, 81, 73, 0.08)',
            color: colors.danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>GitHub repos (connect)</div>
          <div style={{ marginTop: 6, color: colors.muted, fontSize: 13 }}>
            These are pulled from the admin’s GitHub account (server uses stored admin token).
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {githubRepos.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>No repos found (or token missing).</div>
            ) : (
              githubRepos.slice(0, 30).map((r) => {
                const already = connectedRepoIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: 12,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
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
                      style={{
                        ...(already ? buttonBase : buttonPrimary),
                        opacity: already ? 0.6 : 1,
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                      }}
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
          <div style={{ fontWeight: 800 }}>Roles</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="New role name"
              style={inputStyle}
            />
            <button onClick={onCreateRole} style={{ ...buttonPrimary, whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {roles.map((r) => (
              <div
                key={r.id}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ fontWeight: 700 }}>{r.name}</div>
                <div style={{ color: colors.muted, fontSize: 12 }}>{r.is_predefined ? 'predefined' : 'custom'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Groups</div>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New group name"
              style={inputStyle}
            />
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>Members</div>
              <div
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: 10,
                  maxHeight: 180,
                  overflow: 'auto',
                }}
              >
                {users.length === 0 ? (
                  <div style={{ color: colors.muted, fontSize: 13 }}>No users found.</div>
                ) : (
                  users.map((u) => {
                    const checked = newGroupUserIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setNewGroupUserIds((prev) =>
                              prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                            );
                          }}
                        />
                        <span style={{ fontWeight: 700 }}>{u.username}</span>
                        <span style={{ color: colors.muted, fontSize: 12 }}>({u.role})</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <button onClick={onCreateGroup} style={buttonPrimary}>
              Create group
            </button>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {groups.map((g) => (
              <div key={g.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{g.name}</div>
                  <div style={{ color: colors.muted, fontSize: 12 }}>{g.members?.length ?? 0} members</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 800 }}>Connected repos (access)</div>
          <div style={{ marginTop: 6, color: colors.muted, fontSize: 13 }}>
            Set “restricted” and pick roles/groups. Access is OR logic.
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {connected.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>No connected repos yet.</div>
            ) : (
              connected.map((r) => (
                <RepoAccessCard
                  key={r.id}
                  repo={r}
                  roles={roles}
                  groups={groups}
                  onDisconnect={() => onDisconnect(r.id)}
                  onSave={onUpdateAccess}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function RepoAccessCard({
  repo,
  roles,
  groups,
  onDisconnect,
  onSave,
}: {
  repo: ConnectedRepo;
  roles: Role[];
  groups: Group[];
  onDisconnect: () => void;
  onSave: (repoId: number, visibility: 'all' | 'restricted', roleIds: number[], groupIds: number[]) => Promise<void>;
}) {
  const initialRoleIds = useMemo(() => {
    const s = new Set<number>();
    (repo.access_rules ?? []).forEach((a) => {
      if (a.role_id) s.add(a.role_id);
    });
    return Array.from(s);
  }, [repo.access_rules]);

  const initialGroupIds = useMemo(() => {
    const s = new Set<number>();
    (repo.access_rules ?? []).forEach((a) => {
      if (a.group_id) s.add(a.group_id);
    });
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
        <button onClick={onDisconnect} style={{ ...buttonBase, fontSize: 13 }}>
          Disconnect
        </button>
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
              options={roles.map((r) => ({ id: r.id, label: r.name }))}
              selected={roleIds}
              onChange={setRoleIds}
            />
            <MultiSelect
              label="Groups"
              options={groups.map((g) => ({ id: g.id, label: g.name }))}
              selected={groupIds}
              onChange={setGroupIds}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(repo.id, visibility, roleIds, groupIds);
              } finally {
                setSaving(false);
              }
            }}
            style={{
              ...(dirty ? buttonPrimary : buttonBase),
              opacity: !dirty || saving ? 0.6 : 1,
              fontSize: 13,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: number; label: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 10,
          maxHeight: 140,
          overflow: 'auto',
          background: 'rgba(13, 17, 23, 0.4)',
        }}
      >
        {options.length === 0 ? (
          <div style={{ color: colors.muted, fontSize: 13 }}>None</div>
        ) : (
          options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selected.filter((x) => x !== o.id) : [...selected, o.id])}
                />
                <span style={{ fontWeight: 700 }}>{o.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

