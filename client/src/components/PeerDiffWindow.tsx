import { useEffect, useRef, useState, useMemo } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { colorFromUsername, type DiffPatch } from '../store/collabStore';
import { colors, buttonBase } from '../ui/styles';

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

export interface PeerDiffWindowProps {
  myContent: string;
  peerContent: string | null;  // null = still loading
  peerUsername: string;
  filePath: string;
  onClose: () => void;
  onValueChange: (val: string) => void;
  onDiffUpdate: (patches: DiffPatch[], currentContent: string) => void;
}

export default function PeerDiffWindow({
  myContent,
  peerContent,
  peerUsername,
  filePath,
  onClose,
  onValueChange,
  onDiffUpdate,
}: PeerDiffWindowProps) {
  const [leftEditor, setLeftEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [rightEditor, setRightEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInst, setMonacoInst] = useState<typeof Monaco | null>(null);

  const leftDecoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const rightDecoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  const lang = useMemo(() => guessLanguage(filePath), [filePath]);
  const myColor = '#58A6FF';
  const theirColor = colorFromUsername(peerUsername);

  // ── Inject dynamic diff styles ──
  useEffect(() => {
    let el = document.getElementById('collab-diff-styles');
    if (!el) {
      el = document.createElement('style');
      el.id = 'collab-diff-styles';
      document.head.appendChild(el);
    }
    el.innerHTML = `
      .diff-marker-left  { background: ${myColor}28 !important; border-left: 3px solid ${myColor} !important; }
      .diff-marker-right { background: ${theirColor}28 !important; border-left: 3px solid ${theirColor} !important; }
    `;
    return () => {
      const styleEl = document.getElementById('collab-diff-styles');
      if (styleEl) styleEl.remove();
    };
  }, [myColor, theirColor]);

  // ── Synchronized scrolling ──
  useEffect(() => {
    if (!leftEditor || !rightEditor) return;

    let syncing = false;

    const onLeftScroll = leftEditor.onDidScrollChange((e) => {
      if (syncing) return;
      syncing = true;
      rightEditor.setScrollTop(e.scrollTop);
      rightEditor.setScrollLeft(e.scrollLeft);
      requestAnimationFrame(() => { syncing = false; });
    });

    const onRightScroll = rightEditor.onDidScrollChange((e) => {
      if (syncing) return;
      syncing = true;
      leftEditor.setScrollTop(e.scrollTop);
      leftEditor.setScrollLeft(e.scrollLeft);
      requestAnimationFrame(() => { syncing = false; });
    });

    return () => {
      onLeftScroll.dispose();
      onRightScroll.dispose();
    };
  }, [leftEditor, rightEditor]);

  // ── Recompute diff decorations whenever either side changes ──
  useEffect(() => {
    if (!leftEditor || !rightEditor || !monacoInst || peerContent === null) return;

    const recomputeDiff = () => {
      const leftLines = leftEditor.getModel()?.getLinesContent() ?? [];
      const rightLines = rightEditor.getModel()?.getLinesContent() ?? [];
      const maxLen = Math.max(leftLines.length, rightLines.length);

      const leftD: Monaco.editor.IModelDeltaDecoration[] = [];
      const rightD: Monaco.editor.IModelDeltaDecoration[] = [];

      for (let i = 0; i < maxLen; i++) {
        const ln = i + 1;
        if (leftLines[i] !== rightLines[i]) {
          if (i < leftLines.length) {
            leftD.push({
              range: new monacoInst.Range(ln, 1, ln, 1),
              options: { isWholeLine: true, linesDecorationsClassName: 'diff-marker-left' },
            });
          }
          if (i < rightLines.length) {
            rightD.push({
              range: new monacoInst.Range(ln, 1, ln, 1),
              options: { isWholeLine: true, linesDecorationsClassName: 'diff-marker-right' },
            });
          }
        }
      }

      if (!leftDecoRef.current) {
        leftDecoRef.current = leftEditor.createDecorationsCollection(leftD);
      } else {
        leftDecoRef.current.set(leftD);
      }

      if (!rightDecoRef.current) {
        rightDecoRef.current = rightEditor.createDecorationsCollection(rightD);
      } else {
        rightDecoRef.current.set(rightD);
      }
    };

    recomputeDiff();

    // Also recompute when content changes via typing
    const lDisp = leftEditor.onDidChangeModelContent(() => recomputeDiff());
    return () => { lDisp.dispose(); };
  }, [leftEditor, rightEditor, monacoInst, peerContent, myContent]);

  // ── Update right editor model when peer content arrives ──
  useEffect(() => {
    if (!rightEditor || peerContent === null) return;
    const model = rightEditor.getModel();
    if (model && model.getValue() !== peerContent) {
      model.setValue(peerContent);
    }
  }, [peerContent, rightEditor]);

  // ── Left editor mount: wire up patch reporting ──
  const onLeftMount: OnMount = (editor, monaco) => {
    setLeftEditor(editor);
    setMonacoInst(monaco);

    editor.onDidChangeModelContent((e) => {
      const patches: DiffPatch[] = e.changes.map((ch) => ({
        range: {
          startLineNumber: ch.range.startLineNumber,
          startColumn: ch.range.startColumn,
          endLineNumber: ch.range.endLineNumber,
          endColumn: ch.range.endColumn,
        },
        text: ch.text,
        rangeLength: ch.rangeLength,
      }));
      const currentContent = editor.getModel()?.getValue() ?? '';
      onDiffUpdate(patches, currentContent);
    });
  };

  const onRightMount: OnMount = (editor, monaco) => {
    setRightEditor(editor);
    if (!monacoInst) setMonacoInst(monaco);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        padding: '8px 12px',
        background: colors.bg0,
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ fontSize: 13, color: colors.muted }}>
          <span style={{ color: myColor, fontWeight: 'bold' }}>You</span>
          {' vs '}
          <span style={{ color: theirColor, fontWeight: 'bold' }}>{peerUsername}</span>
          {peerContent === null && (
            <span style={{ marginLeft: 12, opacity: 0.6 }}>Loading peer content…</span>
          )}
        </div>
        <button type="button" onClick={onClose} style={{ ...buttonBase, padding: '4px 8px', fontSize: 12 }}>
          Close Diff
        </button>
      </div>

      {/* Two editors side-by-side */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: your file (editable) */}
        <div style={{ flex: 1, borderRight: `1px solid ${colors.border}` }}>
          <Editor
            height="100%"
            theme="vs-dark"
            path={filePath}
            language={lang}
            value={myContent}
            onChange={(v) => onValueChange(v ?? '')}
            onMount={onLeftMount}
            options={{
              readOnly: false,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
        {/* Right: peer's file (read-only) */}
        <div style={{ flex: 1 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            path={`peer-${peerUsername}-${filePath}`}
            language={lang}
            value={peerContent ?? ''}
            onMount={onRightMount}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      </div>
    </div>
  );
}
