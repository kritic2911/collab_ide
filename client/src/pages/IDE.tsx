import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Shell from '../ui/Shell';
import { colors, cardStyle, inputStyle, buttonBase } from '../ui/styles';
import { fetchBranches, fetchFileContent, fetchFileTree, fetchRepos } from '../api/admin';
import { useRepoStore } from '../store/repoStore';
import { useCollabStore } from '../store/collabStore';
import { useWebSocket } from '../hooks/useWebSocket';
import PresenceBar from '../components/PresenceBar';
import CollabEditor from '../components/CollabEditor';
import WebhookLog from '../components/WebhookLog';

type TreeNode = {
  name: string;
  path: string;
  type: 'tree' | 'blob';
  children?: TreeNode[];
};

function buildTree(items: { path: string; type: string }[]): TreeNode[] {
  const root: Record<string, any> = {};
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean);
    let cursor = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      cursor[part] ||= { __path: acc, __children: {} };
      cursor = cursor[part].__children;
    }
  }
  const materialize = (obj: any): TreeNode[] => {
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => {
      const entry = obj[k];
      const path = entry.__path;
      const childKeys = Object.keys(entry.__children || {});
      const children = childKeys.length ? materialize(entry.__children) : undefined;
      return {
        name: k,
        path,
        type: children ? 'tree' : 'blob',
        children,
      };
    });
  };
  const tree = materialize(root);
  const sortFoldersFirst = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .slice()
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1))
      .map((n) => (n.children ? { ...n, children: sortFoldersFirst(n.children) } : n));
  return sortFoldersFirst(tree);
}

function TreeView({
  nodes,
  expanded,
  onToggle,
  onOpenFile,
  activePath,
  depth = 0,
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  activePath: string | null;
  depth?: number;
}) {
  return (
    <div>
      {nodes.map((n) => {
        const isExpanded = expanded.has(n.path);
        const isActive = activePath === n.path;
        return (
          <div key={n.path}>
            <button
              type="button"
              onClick={() => (n.type === 'tree' ? onToggle(n.path) : onOpenFile(n.path))}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '6px 8px',
                paddingLeft: 8 + depth * 14,
                borderRadius: 8,
                border: 'none',
                background: isActive ? 'rgba(88, 166, 255, 0.14)' : 'transparent',
                color: isActive ? colors.text : colors.muted,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ width: 16, color: colors.muted, fontSize: 12 }}>
                {n.type === 'tree' ? (isExpanded ? '▾' : '▸') : '•'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
            </button>
            {n.type === 'tree' && isExpanded && n.children?.length ? (
              <TreeView
                nodes={n.children}
                expanded={expanded}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                activePath={activePath}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function IDE() {
  const { repoId } = useParams();
  const navigate = useNavigate();
  const repoIdNum = Number(repoId);

  const { repos, selectedRepo, selectedBranch, fileTree, setRepos, selectRepo, selectBranch, setFileTree } =
    useRepoStore();
  const {
    roomId,
    peers,
    selectedPeerUsername,
    setRoom,
    setPeers,
    peerJoined,
    peerLeft,
    peerDiff,
    setSelectedPeerUsername,
    clear: clearCollab,
  } = useCollabStore();

  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fileContent, setFileContent] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [snapshotKey, setSnapshotKey] = useState('');
  const [liveWebhook, setLiveWebhook] = useState<{
    id: number;
    event_type: string;
    action: string | null;
    sender_username: string;
    received_at: string;
  } | null>(null);

  const filePathNorm = useMemo(() => {
    if (!activePath) return null;
    return activePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  }, [activePath]);

  const currentRoomIdRef = useRef<string | null>(null);
  const diffSeqRef = useRef(0);

  const { ready, send } = useWebSocket({
    enabled: Number.isFinite(repoIdNum),
    onMessage: useCallback(
      (msg: Record<string, unknown>) => {
        const type = msg.type as string;
        const msgRoomId = (msg.roomId as string | undefined) ?? null;

        // Ignore room-scoped updates if they don't match the currently joined room.
        if (
          type !== 'room_joined' &&
          type !== 'remote_push' &&
          msgRoomId &&
          currentRoomIdRef.current &&
          msgRoomId !== currentRoomIdRef.current
        ) {
          return;
        }

        if (type === 'room_joined') {
          const joinedRoomId = msg.roomId as string;
          currentRoomIdRef.current = joinedRoomId;
          diffSeqRef.current = 0;
          setRoom(joinedRoomId);
          setPeers((msg.peers as { username: string; avatarUrl: string | null }[]) ?? []);
          setSelectedPeerUsername(null);
        } else if (type === 'peer_joined') {
          if (!msgRoomId || msgRoomId !== currentRoomIdRef.current) return;
          peerJoined({
            username: msg.username as string,
            avatarUrl: (msg.avatarUrl as string | null) ?? null,
          });
        } else if (type === 'peer_left') {
          if (!msgRoomId || msgRoomId !== currentRoomIdRef.current) return;
          peerLeft(msg.username as string);
        } else if (type === 'peer_diff') {
          if (!msgRoomId || msgRoomId !== currentRoomIdRef.current) return;
          peerDiff(msg.username as string, msg.patches as any, msg.seq as number);
        } else if (type === 'remote_push') {
          // For the UI: map remote_push into the WebhookLog row shape (best-effort).
          if (!msgRoomId || msgRoomId !== currentRoomIdRef.current) return;
          setLiveWebhook({
            id: Date.now(),
            event_type: 'push',
            action: null,
            sender_username: msg.pushedBy as string,
            received_at: new Date().toISOString(),
          });
        }
      },
      [peerDiff, peerJoined, peerLeft, setPeers, setRoom, setSelectedPeerUsername]
    ),
  });

  useEffect(() => {
    let cancelled = false;
    if (repos.length) return;
    fetchRepos()
      .then((data) => {
        if (!cancelled) setRepos(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repos.length, setRepos]);

  useEffect(() => {
    if (!Number.isFinite(repoIdNum)) return;
    const repo = repos.find((r) => r.id === repoIdNum);
    if (repo) selectRepo(repo);
  }, [repoIdNum, repos, selectRepo]);

  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setLoadingBranches(true);
    fetchBranches(selectedRepo.id)
      .then((data) => {
        if (cancelled) return;
        setBranches(data);
        const next = selectedRepo.default_branch || data?.[0]?.name || null;
        if (next) selectBranch(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load branches');
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectBranch]);

  useEffect(() => {
    if (!selectedRepo || !selectedBranch) return;
    let cancelled = false;
    setLoadingTree(true);
    fetchFileTree(selectedRepo.id, selectedBranch)
      .then((data) => {
        if (!cancelled) {
          setFileTree(data);
          setExpanded(new Set());
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load tree');
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedBranch, setFileTree]);

  useEffect(() => {
    if (!ready || !selectedRepo || !selectedBranch || !filePathNorm) return;

    if (currentRoomIdRef.current) {
      send({ type: 'leave_room', roomId: currentRoomIdRef.current });
    }
    currentRoomIdRef.current = null;
    diffSeqRef.current = 0;
    setLiveWebhook(null);
    clearCollab();

    send({
      type: 'join_room',
      repoId: String(selectedRepo.id),
      branch: selectedBranch,
      filePath: filePathNorm,
    });

    return () => {
      if (currentRoomIdRef.current) {
        send({ type: 'leave_room', roomId: currentRoomIdRef.current });
        currentRoomIdRef.current = null;
      }
    };
  }, [ready, selectedRepo, selectedBranch, filePathNorm, send, clearCollab]);

  const onSelectFile = async (path: string) => {
    if (!selectedRepo || !selectedBranch) return;
    setError(null);
    setLoadingFile(true);
    setActivePath(path);
    try {
      const data = await fetchFileContent(selectedRepo.id, selectedBranch, path);
      const text = data.content ?? '';
      setFileContent(text);
      setSnapshotKey(`${selectedRepo.id}-${selectedBranch}-${path}-${Date.now()}`);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load file');
    } finally {
      setLoadingFile(false);
    }
  };

  const tree = useMemo(() => (fileTree ? buildTree(fileTree) : []), [fileTree]);

  const peerHighlight = useMemo(() => {
    if (selectedPeerUsername == null) return null;
    const p = peers.get(selectedPeerUsername);
    if (!p) return null;
    return {
      color: colorFromUsername(p.username),
      patches: p.patches,
    };
  }, [selectedPeerUsername, peers]);

  function colorFromUsername(username: string): string {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
    const r = hash & 0xff;
    const g = (hash >> 8) & 0xff;
    const b = (hash >> 16) & 0xff;
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  if (!Number.isFinite(repoIdNum)) {
    return (
      <Shell title="IDE">
        <div style={cardStyle}>Invalid repo id.</div>
      </Shell>
    );
  }

  if (repos.length && !selectedRepo) {
    return (
      <Shell title="IDE">
        <div style={cardStyle}>
          Repo not found or access denied.{' '}
          <button type="button" style={{ ...buttonBase, marginLeft: 8 }} onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={selectedRepo ? `IDE • ${selectedRepo.owner}/${selectedRepo.name}` : 'IDE'}>
      {error && (
        <div
          style={{
            marginBottom: 12,
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

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 260px', gap: 12, alignItems: 'stretch' }}>
        <div style={{ ...cardStyle, padding: 12, height: 'calc(100vh - 140px)', overflow: 'auto' }}>
          <div style={{ fontWeight: 800 }}>Files</div>
          <div style={{ marginTop: 8 }}>
            <label style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>Branch</label>
            <select
              value={selectedBranch ?? ''}
              disabled={loadingBranches}
              onChange={(e) => selectBranch(e.target.value)}
              style={{ ...inputStyle, marginTop: 6 }}
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            {loadingTree ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>Loading tree…</div>
            ) : (
              <TreeView
                nodes={tree}
                expanded={expanded}
                onToggle={(p) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  })
                }
                onOpenFile={onSelectFile}
                activePath={activePath}
              />
            )}
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 0, height: 'calc(100vh - 140px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{activePath ?? 'Select a file'}</div>
            <div style={{ marginTop: 8 }}>
              <PresenceBar />
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {activePath ? (
              <CollabEditor
                path={activePath}
                value={fileContent}
                snapshotKey={snapshotKey}
                onValueChange={setFileContent}
                onDiffUpdate={(patches) => {
                  if (!ready) return;
                  const rid = currentRoomIdRef.current;
                  if (!rid) return;
                  diffSeqRef.current += 1;
                  send({ type: 'diff_update', roomId: rid, patches, seq: diffSeqRef.current });
                }}
                peerHighlight={peerHighlight}
              />
            ) : (
              <div style={{ padding: 16, color: colors.muted }}>Pick a file from the tree.</div>
            )}
          </div>
          <div style={{ padding: '6px 12px', borderTop: `1px solid ${colors.border}`, fontSize: 11, color: colors.muted }}>
            {ready ? 'Collaboration connected' : 'Connecting…'} {loadingFile ? ' · Loading file…' : ''}
          </div>
        </div>

        <div style={{ height: 'calc(100vh - 140px)', overflow: 'auto' }}>
          {selectedRepo && (
            <WebhookLog repoId={selectedRepo.id} liveEvent={liveWebhook} />
          )}
        </div>
      </div>
    </Shell>
  );
}
