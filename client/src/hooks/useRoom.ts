import { useEffect, useRef } from 'react';

export function useRoom(
  sendMessage: (msg: any) => void,
  isConnected: boolean,
  repoId: number | null,
  branch: string | null,
  filePath: string | null,
  fileContent: string,
  snapshotKey: string,
) {
  const currentRoom = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !repoId || !branch || !filePath) return;

    // Normalizing filePath identically to server
    const normalizedFile = filePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
    // Join with current editor content so peers get our baseline
    sendMessage({ 
      type: 'join_room', 
      repoId: String(repoId), 
      branch, 
      filePath,
      content: fileContent,
    });
    const roomId = `${repoId}:${branch}:${normalizedFile}`;
    currentRoom.current = roomId;

    return () => {
      // Leave
      sendMessage({ type: 'leave_room', roomId });
      currentRoom.current = null;
    };
    // snapshotKey changes exactly once per file load (after fetchFileContent completes),
    // so this effect re-runs with the correct fileContent after the async fetch.
    // fileContent itself is NOT in deps to avoid re-joining on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, repoId, branch, filePath, sendMessage, snapshotKey]);
}
