import { useEffect, useRef } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useCollabStore, colorFromUsername } from '../store/collabStore';
import { colors } from '../ui/styles';

function guessLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  return 'plaintext';
}

interface PeerDiffWindowProps {
  myContent: string;
  peerUsername: string;
  filePath: string;
  onClose: () => void;
}

export default function PeerDiffWindow({
  myContent,
  peerUsername,
  filePath,
  onClose,
}: PeerDiffWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<Monaco.editor.IDiffEditor | null>(null);
  const originalModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRenderedSeqRef = useRef<number>(0);

  const monaco = useMonaco();

  const peerDoc = useCollabStore((s) => s.peerDocuments.get(peerUsername));
  const peerColor = peerDoc?.color ?? colorFromUsername(peerUsername);
  const peerContent = peerDoc?.content ?? '';
  const peerSeq = peerDoc?.lastSeq ?? 0;

  const language = guessLanguage(filePath);

  // Parse peer color into RGB for theme
  const hex = peerColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 100;
  const g = parseInt(hex.slice(2, 4), 16) || 100;
  const b = parseInt(hex.slice(4, 6), 16) || 100;

  // ── Create diff editor on mount (once monaco is loaded) ──
  useEffect(() => {
    if (!containerRef.current || !monaco) return;

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: true,
      renderSideBySideInlineBreakpoint: 0, // Force side-by-side regardless of window width
      ignoreTrimWhitespace: false,
      renderOverviewRuler: true,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
    });

    const originalModel = monaco.editor.createModel(myContent, language, monaco.Uri.parse(`diff-original-${Date.now()}`));
    const modifiedModel = monaco.editor.createModel(peerContent, language, monaco.Uri.parse(`diff-modified-${Date.now()}`));

    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    diffEditorRef.current = editor;
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    lastRenderedSeqRef.current = peerSeq;

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // Only run when monaco instance becomes available / component mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco]);

  // ── Update original (your content) immediately ──
  useEffect(() => {
    if (originalModelRef.current && originalModelRef.current.getValue() !== myContent) {
      originalModelRef.current.setValue(myContent);
    }
  }, [myContent]);

  // ── Debounced update of modified (peer content) — 1.5s after typing stabilizes ──
  useEffect(() => {
    if (!modifiedModelRef.current) return;
    if (modifiedModelRef.current.getValue() === peerContent) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== peerContent) {
        modifiedModelRef.current.setValue(peerContent);
      }
    }, 1500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [peerContent]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(22, 27, 34, 0.95)',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Peer color ring */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: `2px solid ${peerColor}`,
              background: 'rgba(22, 27, 34, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 800,
              color: colors.text,
            }}
          >
            {peerUsername.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>
            Diff with <span style={{ color: peerColor }}>{peerUsername}</span>
          </span>
          <span style={{ color: colors.muted, fontSize: 11 }}>
            Your file (left) vs their file (right)
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'rgba(248, 81, 73, 0.12)',
            border: '1px solid rgba(248, 81, 73, 0.3)',
            borderRadius: 6,
            color: colors.danger,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ✕ Close Diff
        </button>
      </div>

      {/* Diff Editor Container */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
