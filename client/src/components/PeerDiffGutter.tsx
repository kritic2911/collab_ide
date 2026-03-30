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
  // We use `any` to allow fallback for older Monaco versions if createDecorationsCollection isn't present
  const decoCollection = useRef<any>(null);

  useEffect(() => {
    if (!editor || !monaco) return;

    if (!peerHighlight) {
      if (decoCollection.current) {
        decoCollection.current.clear();
      }
      return;
    }

    const { color, patches } = peerHighlight;
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    const bg = (a: number) => `rgba(${r},${g},${b},${a})`;

    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    const linePatches = new Map<number, DiffPatch[]>();

    // Accumulate all the different changes since pulling
    for (const p of patches) {
      const start = Math.min(p.range.startLineNumber, p.range.endLineNumber);
      const end = Math.max(p.range.startLineNumber, p.range.endLineNumber);
      for (let ln = start; ln <= end; ln++) {
        if (!linePatches.has(ln)) linePatches.set(ln, []);
        linePatches.get(ln)!.push(p);
      }
    }

    const model = editor.getModel();
    if (!model) return;

    for (const [ln, patchesAtLine] of linePatches.entries()) {
      const line = Math.min(Math.max(1, ln), model.getLineCount());
      
      const hoverMessages = patchesAtLine.map(p => {
        let title = '';
        if (p.text === '' && p.rangeLength > 0) {
            title = '**Removed text**';
        } else if (p.text !== '' && p.rangeLength === 0) {
            title = '**Added text**';
        } else {
            title = '**Modified text**';
        }
        
        let msg = title;
        if (p.text) {
            msg += `\n\`\`\`text\n${p.text}\n\`\`\``;
        }
        return { value: msg };
      });

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
          hoverMessage: hoverMessages.length > 0 ? hoverMessages : undefined,
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

    if (!decoCollection.current) {
        if (editor.createDecorationsCollection) {
            decoCollection.current = editor.createDecorationsCollection(decos);
        } else {
            // fallback for older monaco versions
            decoCollection.current = {
                ids: editor.deltaDecorations([], decos),
                clear: () => { editor.deltaDecorations(decoCollection.current.ids, []); },
                set: (newDecos: any) => { decoCollection.current.ids = editor.deltaDecorations(decoCollection.current.ids, newDecos); }
            };
        }
    } else {
        decoCollection.current.set(decos);
    }

    // Clean up decorations on unmount
    return () => {
      if (editor.getModel() && decoCollection.current) {
        decoCollection.current.clear();
      }
    };
  }, [editor, monaco, peerHighlight]);

  return null;
}
