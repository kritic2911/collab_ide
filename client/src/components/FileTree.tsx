import { useMemo, memo, useCallback } from 'react';
import { colors } from '../ui/styles';
import { useCollabStore, colorFromUsername } from '../store/collabStore';

// ──────────────────────────────────────────────
// FileTree — Live Presence File Tree
//
// Recursive tree with:
//   · Collapsible folder nodes
//   · Presence avatar badges (20px circles)
//   · Conflict red-dot badges on files with active conflicts
//   · Directory rollup dots when children have presence
//   · Active file highlight with user's own colour
//   · Hover tooltips on presence badges
//
// The presence data comes from the collabStore peers map.
// Conflict data is passed as a prop from the parent.
// ──────────────────────────────────────────────

/** File/directory tree node shape */
export interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  children?: TreeNode[];
}

/** Active conflict summary per file path */
export interface FileConflictInfo {
  hasConflict: boolean;
  conflictCount: number;
}

interface FileTreeProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  activePath: string | null;
  /** Map of normalized file path → { hasConflict, conflictCount } */
  conflictMap?: Map<string, FileConflictInfo>;
  depth?: number;
}

/**
 * Extract initials from a username for avatar badges.
 *
 * @param username {string} The username to extract initials from.
 * @returns {string} 1-2 character uppercase initials.
 */
function initials(username: string): string {
  const p = username.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase() || '?';
}

// ──────────────────────────────────────────────
// FileTreeNode — Memoized single node renderer
// ──────────────────────────────────────────────

interface FileTreeNodeProps {
  node: TreeNode;
  isExpanded: boolean;
  isActive: boolean;
  depth: number;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  presenceUsers: { username: string; color: string }[];
  hasConflict: boolean;
  conflictCount: number;
  hasChildPresence: boolean;
}

/**
 * FileTreeNode — Single memoized node in the file tree.
 * Renders file/folder icon, name, presence avatars, and conflict badges.
 */
const FileTreeNode = memo(function FileTreeNode({
  node,
  isExpanded,
  isActive,
  depth,
  onToggle,
  onOpenFile,
  presenceUsers,
  hasConflict,
  conflictCount,
  hasChildPresence,
}: FileTreeNodeProps) {
  const isDir = node.type === 'tree';
  const maxAvatars = 3;
  const visibleUsers = presenceUsers.slice(0, maxAvatars);
  const overflow = presenceUsers.length - maxAvatars;

  return (
    <button
      type="button"
      onClick={() => (isDir ? onToggle(node.path) : onOpenFile(node.path))}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '5px 8px',
        paddingLeft: 8 + depth * 14,
        borderRadius: 8,
        border: 'none',
        background: isActive ? 'rgba(88, 166, 255, 0.14)' : 'transparent',
        color: isActive ? colors.text : colors.muted,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        position: 'relative',
        borderLeft: isActive ? `3px solid ${colors.brandA}` : '3px solid transparent',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
    >
      {/* Folder/file icon */}
      <span style={{ width: 16, color: colors.muted, fontSize: 12, flexShrink: 0 }}>
        {isDir ? (isExpanded ? '▾' : '▸') : '•'}
      </span>

      {/* File/folder name */}
      <span style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {node.name}
      </span>

      {/* Directory rollup dot — shows when children have presence */}
      {isDir && !isExpanded && hasChildPresence && (
        <span
          title="Someone is editing a file in this folder"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: colors.brandA,
            flexShrink: 0,
            opacity: 0.7,
          }}
        />
      )}

      {/* Conflict badge — red circle with count */}
      {hasConflict && (
        <span
          title={`${conflictCount} conflict${conflictCount > 1 ? 's' : ''}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: `${colors.danger}25`,
            border: `1.5px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 9,
            fontWeight: 800,
            flexShrink: 0,
            animation: 'conflictPulse 2s ease-in-out 3',
          }}
        >
          {conflictCount > 1 ? conflictCount : '!'}
        </span>
      )}

      {/* Presence avatar badges */}
      {visibleUsers.length > 0 && (
        <span style={{ display: 'flex', flexShrink: 0, marginLeft: 'auto' }}>
          {visibleUsers.map((u, i) => (
            <span
              key={u.username}
              title={u.username}
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(13, 17, 23, 0.9)',
                border: `2px solid ${u.color}`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                fontWeight: 800,
                color: colors.text,
                marginLeft: i > 0 ? -6 : 0,
                zIndex: maxAvatars - i,
                position: 'relative',
              }}
            >
              {initials(u.username)}
            </span>
          ))}
          {overflow > 0 && (
            <span
              style={{
                height: 20,
                padding: '0 5px',
                borderRadius: 10,
                background: 'rgba(139, 148, 158, 0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: colors.muted,
                marginLeft: -4,
              }}
            >
              +{overflow}
            </span>
          )}
        </span>
      )}
    </button>
  );
});

// ──────────────────────────────────────────────
// CSS injection for conflict pulse animation
// ──────────────────────────────────────────────
const STYLE_ID = 'file-tree-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.innerHTML = `
    @keyframes conflictPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }
  `;
  document.head.appendChild(style);
}

// ──────────────────────────────────────────────
// FileTree — Main recursive component
// ──────────────────────────────────────────────

/**
 * Check if any descendant of a directory has presence data.
 * Used for the "rollup dot" on collapsed directories.
 *
 * @param node {TreeNode} The directory node to check.
 * @param presencePaths {Set<string>} Set of file paths with active presence.
 * @returns {boolean} True if any descendant has presence.
 */
function hasDescendantPresence(
  node: TreeNode,
  presencePaths: Set<string>
): boolean {
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.type === 'blob' && presencePaths.has(child.path)) return true;
    if (child.type === 'tree' && hasDescendantPresence(child, presencePaths)) return true;
  }
  return false;
}

/**
 * FileTree — Recursive file tree component with live presence and conflict badges.
 *
 * @param props {FileTreeProps} Tree nodes, state handlers, and optional conflict data.
 * @returns {JSX.Element} The rendered file tree.
 */
export default function FileTree({
  nodes,
  expanded,
  onToggle,
  onOpenFile,
  activePath,
  conflictMap,
  depth = 0,
}: FileTreeProps) {
  const peers = useCollabStore((s) => s.peers);

  // Build a set of paths that have active presence for directory rollup
  const presencePaths = useMemo(() => {
    const paths = new Set<string>();
    // The current room's file path is where all peers are present
    // Each peer in the store is in the currently viewed file
    if (activePath && peers.size > 0) {
      paths.add(activePath);
    }
    return paths;
  }, [activePath, peers]);

  // Build presence user list for the currently active file
  const getPresenceUsers = useCallback(
    (filePath: string) => {
      if (filePath !== activePath) return [];
      return Array.from(peers.values()).map((p) => ({
        username: p.username,
        color: colorFromUsername(p.username),
      }));
    },
    [activePath, peers]
  );

  return (
    <div>
      {nodes.map((n) => {
        const isExpanded = expanded.has(n.path);
        const isActive = activePath === n.path;
        const conflict = conflictMap?.get(n.path);
        const presenceUsers = getPresenceUsers(n.path);
        const childPresence =
          n.type === 'tree' ? hasDescendantPresence(n, presencePaths) : false;

        return (
          <div key={n.path}>
            <FileTreeNode
              node={n}
              isExpanded={isExpanded}
              isActive={isActive}
              depth={depth}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              presenceUsers={presenceUsers}
              hasConflict={conflict?.hasConflict ?? false}
              conflictCount={conflict?.conflictCount ?? 0}
              hasChildPresence={childPresence}
            />
            {n.type === 'tree' && isExpanded && n.children?.length ? (
              <FileTree
                nodes={n.children}
                expanded={expanded}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                activePath={activePath}
                conflictMap={conflictMap}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
