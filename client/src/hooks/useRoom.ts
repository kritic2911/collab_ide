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
  // Capture initial content at the time the file is first selected,
  // so that subsequent edits don't re-trigger the join effect.
  const initialContentRef = useRef<string | null>(null);

  // Update the ref whenever the file identity changes (not on edits)
  useEffect(() => {
    initialContentRef.current = content;
  }, [repoId, branch, filePath]); // only when file identity changes

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath || initialContentRef.current === null) return;

    const normalizedFile = filePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath,
      content: initialContentRef.current,
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
  }, [isConnected, repoId, branch, filePath, sendMessage]);
}
