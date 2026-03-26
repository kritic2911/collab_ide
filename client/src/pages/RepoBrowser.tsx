import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Shell from '../ui/Shell';
import { colors, cardStyle, inputStyle, buttonBase } from '../ui/styles';
import { fetchBranches, fetchFileContent, fetchFileTree, fetchRepos } from '../api/admin';
import { useRepoStore } from '../store/repoStore';
import { useFileStore } from '../store/fileStore';

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
    // mark leaf type on last part
    const last = parts[parts.length - 1];
    if (last) root; // no-op to keep ts happy
    // We'll map type when materializing (blob if not having children)
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

  // Prefer folders first
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

  const { repos, selectedRepo, selectedBranch, fileTree, setRepos, selectRepo, selectBranch, setFileTree } =
    useRepoStore();
  const { openFiles, activePath, activeBranch, setFileContent, setActivePath, setActiveBranch } = useFileStore();

  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Load repos (needed to render header + validate repoId)
  useEffect(() => {
    let cancelled = false;
    if (repos.length) return;
    fetchRepos()
      .then((data) => {
        if (cancelled) return;
        setRepos(data);
      })
      .catch(() => {})
      .finally(() => {});
    return () => {
      cancelled = true;
    };
  }, [repos.length, setRepos]);

  // Select current repo
  useEffect(() => {
    if (!Number.isFinite(repoIdNum)) return;
    const repo = repos.find((r) => r.id === repoIdNum);
    if (repo) selectRepo(repo);
  }, [repoIdNum, repos, selectRepo]);

  // Load branches when repo selected
  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setLoadingBranches(true);
    setError(null);
    fetchBranches(selectedRepo.id)
      .then((data) => {
        if (cancelled) return;
        setBranches(data);
        const defaultBranch = selectedRepo.default_branch;
        const first = data?.[0]?.name;
        const nextBranch = defaultBranch || first || null;
        if (nextBranch) {
          selectBranch(nextBranch);
          setActiveBranch(nextBranch);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load branches');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectBranch, setActiveBranch]);

  // Load file tree when branch selected
  useEffect(() => {
    if (!selectedRepo || !selectedBranch) return;
    let cancelled = false;
    setLoadingTree(true);
    setError(null);
    fetchFileTree(selectedRepo.id, selectedBranch)
      .then((data) => {
        if (cancelled) return;
        setFileTree(data);
        setExpanded(new Set());
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load file tree');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingTree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedBranch, setFileTree]);

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
          Repo not found (or you don’t have access).{' '}
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

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, alignItems: 'stretch' }}>
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

        <div style={{ ...cardStyle, padding: 0, height: 'calc(100vh - 140px)', overflow: 'hidden' }}>
          <div
            style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
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
            <div style={{ color: colors.muted, fontSize: 12 }}>{loadingFile ? 'Loading…' : ''}</div>
          </div>

          <div style={{ height: '100%' }}>
            <Editor
              height="100%"
              theme="vs-dark"
              language={guessLanguage(activePath ?? '')}
              value={content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
              }}
            />
          </div>
        </div>
      </div>
    </Shell>
  );
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

