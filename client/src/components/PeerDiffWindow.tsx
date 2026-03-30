import { useEffect, useRef, useState, useMemo } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useCollabStore, colorFromUsername, DiffPatch } from '../store/collabStore';
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

function injectDiffStyles(myColor: string, theirColor: string) {
  let el = document.getElementById('collab-diff-styles');
  if (!el) {
    el = document.createElement('style');
    el.id = 'collab-diff-styles';
    document.head.appendChild(el);
  }
  el.innerHTML = `
    .diff-marker-left  { background: ${myColor}33 !important; border-left: 3px solid ${myColor} !important; }
    .diff-marker-right { background: ${theirColor}33 !important; border-left: 3px solid ${theirColor} !important; }
  `;
}

export interface PeerDiffWindowProps {
  myContent: string;
  peerUsername: string;
  filePath: string;
  onClose: () => void;
  onValueChange: (val: string) => void;
  onDiffUpdate: (patches: DiffPatch[]) => void;
}

export default function PeerDiffWindow({
  myContent,
  peerUsername,
  filePath,
  onClose,
  onValueChange,
  onDiffUpdate,
}: PeerDiffWindowProps) {
  const peerDocs = useCollabStore((s) => s.peerDocuments);
  const peerDoc = peerDocs.get(peerUsername);
  
  const [leftEditor, setLeftEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [rightEditor, setRightEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInst, setMonacoInst] = useState<typeof Monaco | null>(null);
  
  const leftDecoRef = useRef<any>(null);
  const rightDecoRef = useRef<any>(null);
  const debounceRef = useRef<number>();

  const lang = useMemo(() => guessLanguage(filePath), [filePath]);
  const myColor = '#58A6FF'; // Your own UI blue color preference
  const theirColor = peerDoc?.color ?? colorFromUsername(peerUsername);

  useEffect(() => {
    injectDiffStyles(myColor, theirColor);
    return () => {
      const el = document.getElementById('collab-diff-styles');
      if (el) el.remove();
    };
  }, [myColor, theirColor]);

  // Handle setting diff highlighting whenever models change
  useEffect(() => {
    if (!leftEditor || !rightEditor || !monacoInst) return;
    
    let isHighlighting = false; // Prevents recursive loop
    const highlightDiffs = () => {
      if (isHighlighting) return;
      isHighlighting = true;
      try {
          const leftLines = leftEditor.getModel()!.getLinesContent();
          const rightLines = rightEditor.getModel()!.getLinesContent();
          const maxLen = Math.max(leftLines.length, rightLines.length);

          const leftDecos: Monaco.editor.IModelDeltaDecoration[] = [];
          const rightDecos: Monaco.editor.IModelDeltaDecoration[] = [];

          for (let i = 0; i < maxLen; i++) {
            const lineNum = i + 1;
            if (leftLines[i] !== rightLines[i]) {
              if (i < leftLines.length) {
                leftDecos.push({
                  range: new monacoInst.Range(lineNum, 1, lineNum, 1),
                  options: {
                    isWholeLine: true,
                    linesDecorationsClassName: 'diff-marker-left',
                  }
                });
              }
              if (i < rightLines.length) {
                rightDecos.push({
                  range: new monacoInst.Range(lineNum, 1, lineNum, 1),
                  options: {
                    isWholeLine: true,
                    linesDecorationsClassName: 'diff-marker-right',
                  }
                });
              }
            }
          }

          if (!leftDecoRef.current) {
            if (leftEditor.createDecorationsCollection) {
              leftDecoRef.current = leftEditor.createDecorationsCollection(leftDecos);
            } else {
              leftDecoRef.current = {
                ids: leftEditor.deltaDecorations([], leftDecos),
                clear: () => leftEditor.deltaDecorations(leftDecoRef.current.ids, []),
                set: (d: any) => { leftDecoRef.current.ids = leftEditor.deltaDecorations(leftDecoRef.current.ids, d); }
              };
            }
          } else {
            leftDecoRef.current.set(leftDecos);
          }

          if (!rightDecoRef.current) {
            if (rightEditor.createDecorationsCollection) {
              rightDecoRef.current = rightEditor.createDecorationsCollection(rightDecos);
            } else {
              rightDecoRef.current = {
                ids: rightEditor.deltaDecorations([], rightDecos),
                clear: () => rightEditor.deltaDecorations(rightDecoRef.current.ids, []),
                set: (d: any) => { rightDecoRef.current.ids = rightEditor.deltaDecorations(rightDecoRef.current.ids, d); }
              };
            }
          } else {
            rightDecoRef.current.set(rightDecos);
          }
      } finally {
        isHighlighting = false;
      }
    };

    highlightDiffs();

    // Re-run highlighting when models change
    const lDisp = leftEditor.onDidChangeModelContent(() => highlightDiffs());
    const rDisp = rightEditor.onDidChangeModelContent(() => highlightDiffs());

    return () => {
      lDisp.dispose();
      rDisp.dispose();
      leftDecoRef.current?.clear();
      rightDecoRef.current?.clear();
    };
  }, [leftEditor, rightEditor, monacoInst]);

  // Sync scrolling
  useEffect(() => {
    if (!leftEditor || !rightEditor) return;

    let isSyncingLeft = false;
    let isSyncingRight = false;

    const onLeftScroll = leftEditor.onDidScrollChange((e) => {
      if (isSyncingLeft) return;
      isSyncingRight = true;
      rightEditor.setScrollTop(e.scrollTop);
      rightEditor.setScrollLeft(e.scrollLeft);
      setTimeout(() => { isSyncingRight = false; }, 0);
    });

    const onRightScroll = rightEditor.onDidScrollChange((e) => {
      if (isSyncingRight) return;
      isSyncingLeft = true;
      leftEditor.setScrollTop(e.scrollTop);
      leftEditor.setScrollLeft(e.scrollLeft);
      setTimeout(() => { isSyncingLeft = false; }, 0);
    });

    return () => {
      onLeftScroll.dispose();
      onRightScroll.dispose();
    };
  }, [leftEditor, rightEditor]);

  // Bind right editor content from peer tracking
  useEffect(() => {
    if (!rightEditor || !peerDoc) return;
    const model = rightEditor.getModel();
    if (model && model.getValue() !== peerDoc.content) {
      model.setValue(peerDoc.content);
    }
  }, [peerDoc, rightEditor]);

  const onLeftMount: OnMount = (editor, monaco) => {
    setLeftEditor(editor);
    setMonacoInst(monaco);

    // Patch reporting
    editor.onDidChangeModelContent((e) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
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
        onDiffUpdate(patches);
      }, 350);
    });
  };

  const onRightMount: OnMount = (editor, monaco) => {
    setRightEditor(editor);
    setMonacoInst(monaco);
  };

  if (!peerDoc) {
    return (
        <div style={{ padding: 16, color: colors.muted }}>
            <p>Peer data not loaded. They may have disconnected.</p>
            <button onClick={onClose} style={buttonBase}>Back to Editor</button>
        </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', padding: '8px 12px', background: colors.background, alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ fontSize: 13, color: colors.muted }}>
          <span style={{ color: myColor, fontWeight: 'bold' }}>You</span> vs <span style={{ color: theirColor, fontWeight: 'bold' }}>{peerUsername}</span>
        </div>
        <button type="button" onClick={onClose} style={{ ...buttonBase, padding: '4px 8px', fontSize: 12 }}>Close Diff</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            path={`peer-${peerUsername}-${filePath}`}
            language={lang}
            value={peerDoc.content}
            onMount={onRightMount}
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
  );
}
