import { useEffect, useRef } from 'react';

export function useRoom(
  sendMessage: (msg: any) => void,
  isConnected: boolean,
  repoId: number | null,
  branch: string | null,
  filePath: string | null
) {
  const currentRoom = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath) return;

    // Normalizing filePath identically to server
    const normalizedFile = filePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
    // Join
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath 
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      // Leave
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
  }, [isConnected, repoId, branch, filePath, sendMessage]);
}
