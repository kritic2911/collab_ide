import { useEffect, useRef } from 'react';

export function useRoom(
  sendMessage: (msg: any) => void,
  isConnected: boolean,
  repoId: number | null,
  branch: string | null,
  filePath: string | null,
  content: string | null,
) {
  const currentRoom = useRef<string | null>(null);
  // Capture the initial content once so the effect doesn't re-fire on every keystroke.
  // contentRef always points at the latest value, but the effect only depends on
  // the identity-stable inputs (repoId, branch, filePath, isConnected).
  const contentRef = useRef<string | null>(content);
  contentRef.current = content;

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath) return;

    // Wait until initial content is loaded
    const initialContent = contentRef.current;
    if (initialContent === null) return;

    const normalizedFile = filePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath: normalizedFile,
      content: initialContent,
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
    // content intentionally excluded — we only join once per file switch,
    // using whatever content was available at that moment via contentRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, repoId, branch, filePath, sendMessage]);
}
