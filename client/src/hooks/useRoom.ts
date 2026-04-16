import { useEffect, useRef } from 'react';

export function useRoom(
  sendMessage: (msg: any) => void,
  isConnected: boolean,
  repoId: number | null,
  branch: string | null,
  filePath: string | null,
  content: string | null, // <-- added back
) {
  const currentRoom = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath || content === null) return;

    const normalizedFile = filePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath,
      content, // send actual initial content
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
  }, [isConnected, repoId, branch, filePath, content, sendMessage]);
}
