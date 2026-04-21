import { useEffect, useRef } from 'react';

export function useRoom(
  sendMessage: (msg: any) => void,
  isConnected: boolean,
  repoId: number | null,
  branch: string | null,
  filePath: string | null,
  content: string | null, // used for initial join payload only
) {
  const currentRoom = useRef<string | null>(null);

  // Capture latest content in a ref so the join message
  // can include it without re-triggering the effect on every keystroke.
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath || contentRef.current === null) return;

    const normalizedFile = filePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath,
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
    // NOTE: `content` is intentionally excluded to prevent re-join on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, repoId, branch, filePath, sendMessage]);
}

