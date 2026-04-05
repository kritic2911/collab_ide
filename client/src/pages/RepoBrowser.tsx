import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Shell from '../ui/Shell';
import { colors, cardStyle, inputStyle, buttonBase } from '../ui/styles';
import { fetchBranches, fetchFileContent, fetchFileTree, fetchRepos } from '../api/admin';
import { useRepoStore } from '../store/repoStore';
import { useFileStore } from '../store/fileStore';
import { useWebSocket, onServerMessage } from '../hooks/useWebSocket';
import { usePresence, usePresenceStore } from '../hooks/usePresence';
import { getUser } from '../hooks/useAuth';
import PresenceAvatars from '../components/PresenceAvatars';

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
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      cursor[part] ||= { __path: acc, __children: {} };
      cursor = cursor[part].__children;
    }
    const last = parts[parts.length - 1];
    if (last) root; // no-op to keep ts happy
  }

  const materialize = (obj: any, basePath = ''): TreeNode[] => {
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => {
      const entry = obj[k];
      const path = entry.__path || (basePath ? `${basePath}/${k}` : k);
      const childKeys = Object.keys(entry.__children || {});
      const children = childKeys.length ? materialize(entry.__children, path) : undefined;
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

export default function RepoBrowser() {
  const { repoId } = useParams();
  const navigate = useNavigate();
  const repoIdNum = Number(repoId);
  const user = getUser();

  const { repos, selectedRepo, selectedBranch, fileTree, setRepos, selectRepo, selectBranch, setFileTree } =
    useRepoStore();
  const { openFiles, activePath, activeBranch, setFileContent, setActivePath, setActiveBranch } = useFileStore();

  // ── WebSocket + Presence ──
  const { send } = useWebSocket();
  usePresence(repoIdNum, selectedBranch, activePath);
  const currentRoomId = usePresenceStore((s) => s.currentRoomId);

  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // ── Peer viewing state ──
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [peerContent, setPeerContent] = useState<string>('');
  const [peerDocReady, setPeerDocReady] = useState(false);

  // ── Editor refs ──
  const editorRef = useRef<any>(null);
  const peerEditorRef = useRef<any>(null);
  const peerMonacoRef = useRef<any>(null);
  const seqRef = useRef(0);
  const pendingPeerDiffsRef = useRef<any[]>([]);

  // Load repos
  useEffect(() => {
    let cancelled = false;
    if (repos.length) return;
    fetchRepos()
      .then((data) => { if (!cancelled) setRepos(data); })
      .catch(() => {})
      .finally(() => {});
    return () => { cancelled = true; };
  }, [repos.length, setRepos]);

  // Select current repo
  useEffect(() => {
    if (!Number.isFinite(repoIdNum)) return;
    const repo = repos.find((r) => r.id === repoIdNum);
    if (repo) selectRepo(repo);
  }, [repoIdNum, repos, selectRepo]);

  // Load branches
  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setLoadingBranches(true);
    setError(null);
    fetchBranches(selectedRepo.id)
      .then((data) => {
        if (cancelled) return;
        setBranches(data);
        const nextBranch = selectedRepo.default_branch || data?.[0]?.name || null;
        if (nextBranch) {
          selectBranch(nextBranch);
          setActiveBranch(nextBranch);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load branches'); })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
  }, [selectedRepo, selectBranch, setActiveBranch]);

  // Load file tree
  useEffect(() => {
    if (!selectedRepo || !selectedBranch) return;
    let cancelled = false;
    setLoadingTree(true);
    setError(null);
    fetchFileTree(selectedRepo.id, selectedBranch)
      .then((data) => { if (!cancelled) { setFileTree(data); setExpanded(new Set()); } })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load file tree'); })
      .finally(() => { if (!cancelled) setLoadingTree(false); });
    return () => { cancelled = true; };
  }, [selectedRepo, selectedBranch, setFileTree]);

  // ── Close peer pane when switching files ──
  useEffect(() => {
    setSelectedPeer(null);
    setPeerContent('');
    setPeerDocReady(false);
    pendingPeerDiffsRef.current = [];
  }, [activePath]);

  // ── Handle server messages for peer document ──
  useEffect(() => {
    const unsub = onServerMessage((msg) => {
      // Auto-respond to doc_requested: another peer wants our document
      if (msg.type === 'doc_requested' && currentRoomId) {
        const myContent = editorRef.current?.getValue() ?? '';
        send({
          type: 'doc_response',
          roomId: msg.roomId,
          targetUsername: msg.requestedBy,
          content: myContent,
        });
      }

      // Received a peer's full document
      if (msg.type === 'peer_doc_content') {
        setPeerContent(msg.content);
        setPeerDocReady(true);
        // Apply any queued diffs
        const queued = pendingPeerDiffsRef.current;
        pendingPeerDiffsRef.current = [];
        if (queued.length > 0 && peerEditorRef.current && peerMonacoRef.current) {
          applyDiffsToPeerEditor(queued, peerEditorRef.current, peerMonacoRef.current);
        }
      }

      // Incoming peer diff — apply to peer pane if it's from the selected peer
      if (msg.type === 'peer_diff' && msg.username === selectedPeer) {
        if (!peerDocReady) {
          pendingPeerDiffsRef.current.push(...msg.patches);
        } else if (peerEditorRef.current && peerMonacoRef.current) {
          applyDiffsToPeerEditor(msg.patches, peerEditorRef.current, peerMonacoRef.current);
        }
      }

      // If the selected peer left, close the pane
      if (msg.type === 'peer_left' && msg.username === selectedPeer) {
        setSelectedPeer(null);
        setPeerContent('');
        setPeerDocReady(false);
      }
    });
    return unsub;
  }, [currentRoomId, selectedPeer, peerDocReady, send]);

  const tree = useMemo(() => (fileTree ? buildTree(fileTree) : []), [fileTree]);
  const content = activePath ? openFiles.get(activePath) ?? '' : '';

  const onSelectFile = async (path: string) => {
    if (!selectedRepo || !selectedBranch) return;
    setError(null);
    setLoadingFile(true);
    try {
      const data = await fetchFileContent(selectedRepo.id, selectedBranch, path);
      setFileContent(path, data.content ?? '');
      setActivePath(path);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load file');
    } finally {
      setLoadingFile(false);
    }
  };

  // ── Editor onChange → send diff_update ──
  const handleEditorChange = useCallback((_value: string | undefined, ev: any) => {
    if (!activePath || !ev?.changes || !currentRoomId) return;
    // Also keep store in sync
    if (_value !== undefined) setFileContent(activePath, _value);

    const patches = ev.changes.map((c: any) => ({
      range: {
        startLineNumber: c.range.startLineNumber,
        startColumn: c.range.startColumn,
        endLineNumber: c.range.endLineNumber,
        endColumn: c.range.endColumn,
      },
      text: c.text,
      rangeLength: c.rangeLength,
    }));

    seqRef.current += 1;
    send({
      type: 'diff_update',
      roomId: currentRoomId,
      patches,
      seq: seqRef.current,
    });
  }, [activePath, currentRoomId, send, setFileContent]);

  // ── Select a peer to view ──
  const handleSelectPeer = useCallback((username: string) => {
    if (username === selectedPeer) {
      // Toggle off
      setSelectedPeer(null);
      setPeerContent('');
      setPeerDocReady(false);
      return;
    }
    setSelectedPeer(username);
    setPeerContent('');
    setPeerDocReady(false);
    pendingPeerDiffsRef.current = [];
    // Request their document
    if (currentRoomId) {
      send({
        type: 'request_peer_doc',
        roomId: currentRoomId,
        targetUsername: username,
      });
    }
  }, [selectedPeer, currentRoomId, send]);

  const closePeerPane = useCallback(() => {
    setSelectedPeer(null);
    setPeerContent('');
    setPeerDocReady(false);
  }, []);

  // ── Early returns ──
  if (!Number.isFinite(repoIdNum)) {
    return (
      <Shell title="Browse">
        <div style={cardStyle}>Invalid repo id.</div>
      </Shell>
    );
  }

  if (repos.length && !selectedRepo) {
    return (
      <Shell title="Browse">
        <div style={cardStyle}>
          Repo not found (or you don't have access).{' '}
          <button style={{ ...buttonBase, marginLeft: 8 }} onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={selectedRepo ? `Browse • ${selectedRepo.owner}/${selectedRepo.name}` : 'Browse'}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, alignItems: 'stretch' }}>
        {/* ── File tree sidebar ── */}
        <div style={{ ...cardStyle, padding: 12, height: 'calc(100vh - 140px)', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontWeight: 800 }}>Files</div>
            <div style={{ color: colors.muted, fontSize: 12 }}>{loadingTree ? 'Loading…' : ''}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>Branch</label>
            <select
              value={selectedBranch ?? ''}
              disabled={loadingBranches || branches.length === 0}
              onChange={(e) => {
                const next = e.target.value;
                selectBranch(next);
                setActiveBranch(next);
              }}
              style={{ ...inputStyle, marginTop: 6 }}
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
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
                onToggle={(p) => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  });
                }}
                onOpenFile={onSelectFile}
                activePath={activePath}
              />
            )}
          </div>
        </div>

        {/* ── Editor area ── */}
        <div
          style={{
            ...cardStyle,
            padding: 0,
            height: 'calc(100vh - 140px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header bar */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activePath ? activePath : 'Select a file'}
              </div>
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {activeBranch ? `Branch: ${activeBranch}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PresenceAvatars
                currentUsername={user?.username ?? ''}
                selectedPeer={selectedPeer}
                onSelectPeer={handleSelectPeer}
              />
              <div style={{ color: colors.muted, fontSize: 12 }}>{loadingFile ? 'Loading…' : ''}</div>
            </div>
          </div>

          {/* Editor panes */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Main editor — editable */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <Editor
                height="100%"
                theme="vs-dark"
                language={guessLanguage(activePath ?? '')}
                value={content}
                onChange={handleEditorChange}
                onMount={(editor) => { editorRef.current = editor; }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                }}
              />
            </div>

            {/* Peer editor — read-only, closeable */}
            {selectedPeer && (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  borderLeft: `1px solid ${colors.border}`,
                  overflow: 'hidden',
                }}
              >
                {/* Peer pane header */}
                <div
                  style={{
                    padding: '6px 12px',
                    borderBottom: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    background: 'rgba(88,166,255,0.06)',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: colors.muted }}>👁</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.brandA }}>
                      {selectedPeer}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: colors.muted,
                        background: 'rgba(255,255,255,0.06)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      read-only
                    </span>
                  </div>
                  <button
                    onClick={closePeerPane}
                    title="Close peer view"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      color: colors.muted,
                      cursor: 'pointer',
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(248,81,73,0.2)';
                      (e.currentTarget as HTMLElement).style.color = colors.danger;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = colors.muted;
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Peer editor content */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {!peerDocReady ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: colors.muted,
                        fontSize: 13,
                      }}
                    >
                      Loading {selectedPeer}'s code…
                    </div>
                  ) : (
                    <Editor
                      key={selectedPeer}
                      height="100%"
                      theme="vs-dark"
                      language={guessLanguage(activePath ?? '')}
                      value={peerContent}
                      onMount={(editor, monaco) => {
                        peerEditorRef.current = editor;
                        peerMonacoRef.current = monaco;
                      }}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 13,
                        wordWrap: 'on',
                        domReadOnly: true,
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Apply DiffPatch[] to the peer Monaco editor ──
function applyDiffsToPeerEditor(patches: any[], editor: any, monaco: any) {
  try {
    const edits = patches.map((p: any) => ({
      range: new monaco.Range(
        p.range.startLineNumber,
        p.range.startColumn,
        p.range.endLineNumber,
        p.range.endColumn,
      ),
      text: p.text,
    }));
    editor.executeEdits('peer-sync', edits);
  } catch {
    // Ignore edit errors (e.g. stale ranges)
  }
}

// ── TreeView component ──
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

function guessLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  return 'plaintext';
}
