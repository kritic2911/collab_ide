import { useEffect, useRef, useMemo, memo } from 'react';
import type * as Monaco from 'monaco-editor';
import type { DiffPatch } from '../store/collabStore';

// ──────────────────────────────────────────────
// PeerDiffGutter — Monaco decoration manager
//
// Shows coloured gutter marks and inline highlights
// on lines modified by a remote peer.
//
// Optimised with:
//   · useMemo on decoration computation
//   · Stable style element (inject once)
//   · Decoration collection reuse (no recreate)
// ──────────────────────────────────────────────

interface PeerDiffGutterProps {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  peerHighlight?: {
    color: string;
    patches: DiffPatch[];
  } | null;
}

/**
 * Compute a simple hash for a patch array to enable memoisation.
 * Only re-decorate when the patches actually differ.
 *
 * @param patches {DiffPatch[]} Array of patches to hash.
 * @returns {string} A deterministic hash string.
 */
function patchHash(patches: DiffPatch[]): string {
  if (!patches || patches.length === 0) return 'empty';
  return patches
    .map(
      (p) =>
        `${p.range.startLineNumber}:${p.range.startColumn}-${p.range.endLineNumber}:${p.range.endColumn}|${p.text}|${p.rangeLength}`
    )
    .join(';');
}

/**
 * Build Monaco decorations for the given patches.
 * Pure function — no side effects, fully memoizable.
 *
 * @param monaco {typeof Monaco} The Monaco namespace.
 * @param model {Monaco.editor.ITextModel} The current editor model.
 * @param patches {DiffPatch[]} Patches to visualise.
 * @returns {Monaco.editor.IModelDeltaDecoration[]} Decorations array.
 */
function buildDecorations(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  patches: DiffPatch[]
): Monaco.editor.IModelDeltaDecoration[] {
  // Group patches by line for hover messages
  const linePatches = new Map<number, DiffPatch[]>();

  for (const p of patches) {
    const start = Math.min(p.range.startLineNumber, p.range.endLineNumber);
    const end = Math.max(p.range.startLineNumber, p.range.endLineNumber);
    for (let ln = start; ln <= end; ln++) {
      if (!linePatches.has(ln)) linePatches.set(ln, []);
      linePatches.get(ln)!.push(p);
    }
  }

  const decos: Monaco.editor.IModelDeltaDecoration[] = [];

  for (const [ln, patchesAtLine] of linePatches.entries()) {
    const line = Math.min(Math.max(1, ln), model.getLineCount());

    // Build hover messages describing each change
    const hoverMessages = patchesAtLine.map((p) => {
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
          color: 'rgba(0,0,0,0)', // set dynamically via CSS
          position: monaco.editor.OverviewRulerLane.Full,
        },
        className: 'peer-diff-inline',
        marginClassName: 'peer-diff-margin',
        hoverMessage: hoverMessages.length > 0 ? hoverMessages : undefined,
      },
    });
  }

  return decos;
}

/**
 * PeerDiffGutter — Renders Monaco decorations for peer edits.
 * Memoised to prevent unnecessary re-renders on every diff event.
 *
 * @param props {PeerDiffGutterProps} Editor, Monaco namespace, and peer highlight data.
 * @returns {null} This component renders nothing — it only manages Monaco decorations.
 */
export default memo(function PeerDiffGutter({
  editor,
  monaco,
  peerHighlight,
}: PeerDiffGutterProps) {
  // Tracks the Monaco decoration collection across renders
  const decoCollection = useRef<any>(null);

  // Memoise the patch hash to skip unnecessary decoration updates
  const currentHash = useMemo(
    () => (peerHighlight ? patchHash(peerHighlight.patches) : 'none'),
    [peerHighlight]
  );

  useEffect(() => {
    if (!editor || !monaco) return;

    // No highlight → clear existing decorations
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

    // Inject/update dynamic CSS for peer colour
    let styleEl = document.getElementById('peer-diff-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'peer-diff-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
      .peer-diff-inline {
        background-color: ${bg(0.15)};
      }
      .peer-diff-margin {
        border-left: 4px solid ${color};
        background-color: ${bg(0.2)};
      }
    `;

    const model = editor.getModel();
    if (!model) return;

    // Build decorations from patches
    const decos = buildDecorations(monaco, model, patches);

    // Apply decorations via collection (reuse existing)
    if (!decoCollection.current) {
      if (editor.createDecorationsCollection) {
        decoCollection.current = editor.createDecorationsCollection(decos);
      } else {
        // Fallback for older Monaco versions
        decoCollection.current = {
          ids: editor.deltaDecorations([], decos),
          clear: () => {
            editor.deltaDecorations(decoCollection.current.ids, []);
          },
          set: (newDecos: any) => {
            decoCollection.current.ids = editor.deltaDecorations(
              decoCollection.current.ids,
              newDecos
            );
          },
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
    // currentHash drives re-render only when patches actually change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monaco, currentHash, editor?.getModel()?.uri.toString()]);

  return null;
});
