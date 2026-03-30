import { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { DiffPatch } from '../store/collabStore';

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

/** Coarse line diff vs initial snapshot (awareness-only). */
export function computeLineDiffFromSnapshot(original: string, current: string) {
  const o = original.length ? original.split('\n') : [];
  const c = current.length ? current.split('\n') : [];
  const added: number[] = [];
  const modified: number[] = [];
  const deleted: number[] = [];
  const max = Math.max(o.length, c.length);
  for (let i = 0; i < max; i++) {
    const line = i + 1;
    if (i >= o.length) added.push(line);
    else if (i >= c.length) deleted.push(line);
    else if (o[i] !== c[i]) modified.push(line);
  }
  return { added, modified, deleted };
}

export interface CollabEditorProps {
  path: string;
  value: string;
  /** Change when loading a new file so the diff baseline resets. */
  snapshotKey: string;
  onValueChange: (value: string) => void;
  onDiffUpdate: (patches: DiffPatch[]) => void;
  peerHighlight?: {
    color: string;
    patches: DiffPatch[];
  } | null;
}

export default function CollabEditor({
  path,
  value,
  snapshotKey,
  onValueChange,
  onDiffUpdate,
  peerHighlight,
}: CollabEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const originalRef = useRef<string>(value);
  const decoIds = useRef<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    originalRef.current = value;
  }, [snapshotKey]);

  function applyPeerDecorations(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
    highlight: CollabEditorProps['peerHighlight'] | null | undefined
  ) {
    const model = editor.getModel();
    if (!model) return;

    if (!highlight) {
      decoIds.current = editor.deltaDecorations(decoIds.current, []);
      return;
    }

    const { color, patches } = highlight;
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const bg = (a: number) => `rgba(${r},${g},${b},${a})`;

    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    const linesToHighlight = new Set<number>();
    for (const p of patches) {
      const start = Math.min(p.range.startLineNumber, p.range.endLineNumber);
      const end = Math.max(p.range.startLineNumber, p.range.endLineNumber);
      for (let ln = start; ln <= end; ln++) linesToHighlight.add(ln);
    }

    for (const ln of linesToHighlight) {
      const line = Math.min(Math.max(1, ln), model.getLineCount());
      decos.push({
        range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
        options: {
          isWholeLine: true,
          overviewRuler: {
            color: bg(0.45),
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      });
    }

    decoIds.current = editor.deltaDecorations(decoIds.current, decos);
  }

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    applyPeerDecorations(editor, monaco, peerHighlight ?? null);
  }, [peerHighlight, snapshotKey]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeModelContent((e) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
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

    applyPeerDecorations(editor, monaco, peerHighlight ?? null);
  };

  return (
    <Editor
      key={snapshotKey}
      height="100%"
      theme="vs-dark"
      path={path}
      language={guessLanguage(path)}
      value={value}
      onChange={(v) => onValueChange(v ?? '')}
      onMount={onMount}
      options={{
        readOnly: false,
        minimap: { enabled: true },
        fontSize: 13,
        wordWrap: 'on',
      }}
    />
  );
}
