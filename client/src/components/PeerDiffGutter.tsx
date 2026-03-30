import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import type { DiffPatch } from '../store/collabStore';

interface PeerDiffGutterProps {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  peerHighlight?: {
    color: string;
    patches: DiffPatch[];
  } | null;
}

export default function PeerDiffGutter({ editor, monaco, peerHighlight }: PeerDiffGutterProps) {
  const decoIds = useRef<string[]>([]);

  useEffect(() => {
    if (!editor || !monaco) return;

    if (!peerHighlight) {
      decoIds.current = editor.deltaDecorations(decoIds.current, []);
      return;
    }

    const { color, patches } = peerHighlight;
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    const bg = (a: number) => `rgba(${r},${g},${b},${a})`;

    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    const linesToHighlight = new Set<number>();
    
    // Accumulate all the different changes since pulling
    for (const p of patches) {
      const start = Math.min(p.range.startLineNumber, p.range.endLineNumber);
      const end = Math.max(p.range.startLineNumber, p.range.endLineNumber);
      for (let ln = start; ln <= end; ln++) linesToHighlight.add(ln);
    }

    const model = editor.getModel();
    if (!model) return;

    for (const ln of linesToHighlight) {
      const line = Math.min(Math.max(1, ln), model.getLineCount());
      decos.push({
        range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
        options: {
          isWholeLine: true,
          overviewRuler: {
            color: bg(0.8),
            position: monaco.editor.OverviewRulerLane.Full,
          },
          // Using marginClassName for actual "Gutter" visual effect
          // Using className for the code background effect
          className: 'peer-diff-inline',
          marginClassName: 'peer-diff-margin',
        },
      });
    }

    // A little bit of global CSS to support the classes we inject here
    let styleEl = document.getElementById('peer-diff-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'peer-diff-styles';
      document.head.appendChild(styleEl);
    }
    // Set dynamic style since the color changes depending on the peer
    styleEl.innerHTML = `
      .peer-diff-inline {
        background-color: ${bg(0.15)};
      }
      .peer-diff-margin {
        border-left: 4px solid ${color};
        background-color: ${bg(0.2)};
      }
    `;

    decoIds.current = editor.deltaDecorations(decoIds.current, decos);

    // Clean up decorations on unmount
    return () => {
      if (editor.getModel()) {
        decoIds.current = editor.deltaDecorations(decoIds.current, []);
      }
    };
  }, [editor, monaco, peerHighlight]);

  return null;
}
