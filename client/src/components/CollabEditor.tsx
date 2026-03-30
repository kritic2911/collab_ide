import { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { DiffPatch } from '../store/collabStore';
import PeerDiffGutter from './PeerDiffGutter';

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
  const [editorInst, setEditorInst] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInst, setMonacoInst] = useState<typeof Monaco | null>(null);
  const originalRef = useRef<string>(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    originalRef.current = value;
  }, [snapshotKey]);



  const onMount: OnMount = (editor, monaco) => {
    setEditorInst(editor);
    setMonacoInst(monaco);

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


  };

  return (
    <>
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
      <PeerDiffGutter editor={editorInst} monaco={monacoInst} peerHighlight={peerHighlight} />
    </>
  );
}
