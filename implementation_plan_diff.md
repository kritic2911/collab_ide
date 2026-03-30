# Implement Diff Window Collaboration

This plan details how to implement the diff window functionality when clicking a peer's bubble in the collaborative IDE, following the "Google Docs" presence model.

## Proposed Changes

### 1. Types & Data Structures
We will update the payload schemas for `join_room` and `room_joined` so that initial file states are shared as users enter the room.
#### [MODIFY] `server/src/ws/ws.types.ts`
- Add `content: string` to the `join_room` ClientMessage.
- Add `currentContent: string` and `seq: number` to the peers array in the `room_joined` ServerMessage.
- Add `currentContent: string` and `seq: number` to the `peer_joined` ServerMessage.

### 2. Server-side Document Tracking
The server will now maintain a lightweight shadow document of each user's file content to serve to newly joining peers.
#### [MODIFY] `server/src/ws/roomManager.ts`
- Change `rooms` from `Map<string, Set<AuthenticatedSocket>>` to `Map<string, Map<AuthenticatedSocket, { content: string; seq: number }>>`.
- Update `joinRoom` to accept and store the initial `content` and initialize `seq`.
- Update `getRoomPeers` to return `currentContent` and `seq` alongside `username` and `avatarUrl`.

#### [MODIFY] `server/src/ws/messageHandler.ts`
- Introduce a helper `applyPatches(text: string, patches: DiffPatch[]): string` to apply Monaco's differential patches.
- In `onJoinRoom`, pass the client's payload `content` to `joinRoom`.
- In `onDiffUpdate`, fetch the user's state, apply `msg.patches` to their tracked `content`, update their `seq`, and then broadcast to peers.

### 3. Client-side Shadow Documents
The frontend will maintain a reconstructed document per peer so that it is instantly available for diffing without network requests.
#### [MODIFY] `client/src/store/collabStore.ts`
- Add a `peerDocuments: Map<string, PeerDoc>` where `PeerDoc = { username, color, content, lastSeq }`.
- Write the `applyPatches` helper to apply changes synchronously.
- Update `setPeers`, `peerJoined`, `peerLeft`, and `peerDiff` actions to initialize and patch `peerDocuments` contents appropriately.
- Ensure that if `peerLeft` fires for `selectedPeerUsername`, `selectedPeerUsername` is set to `null` to automatically close the diff window.

### 4. Diff Window UI
We will introduce a new DiffWindow component and hook it into the main IDE layout.
#### [MODIFY] `client/src/hooks/useRoom.ts`
- Update the `join_room` payload to pass the active `fileContent` from the editor.

#### [NEW] `client/src/components/PeerDiffWindow.tsx`
- A new component that wraps `monaco.editor.createDiffEditor`.
- Uses `myContent` (from local editor) and `peerContent` (from `collabStore`'s `peerDocuments`) to initialize the models.
- Uses a debounced effect (e.g. 1.5s delay based on `seq` stability) to update the modified model when the peer pushes new changes.
- Contains an overlay UI or standard layout to provide a "Close Diff" button.

#### [MODIFY] `client/src/pages/IDE.tsx`
- If `selectedPeerUsername` is active, render `<PeerDiffWindow>` instead of `<CollabEditor>`.
- Make sure to pass the local file content to `useRoom` so it is included when sending the `join_room` signal.

#### [MODIFY] `client/src/components/PeerDiffGutter.tsx`
- Ensure the `useEffect` recalculates and re-renders decorations when the file view is refreshed by guarding against stale paths. (As per standard file navigation behaviors).

## Open Questions

- We'll implement closing the diff window on peer file change (handled inherently by clearing `selectedPeerUsername` when their `peerLeft` event fires). Is there any specific UX you want when the diff window forcibly closes, or is just dropping them back into the normal editor sufficient?

## Verification Plan

### Manual Verification
1. Open the same file in two separate browser sessions (User A and User B).
2. User A types a few lines.
3. User B clicks User A's bubble in the presence bar.
4. User B should see a side-by-side diff: Left = User B's state, Right = User A's state.
5. User A types more while User B holds the diff window open. User B's diff should update (debounced) without interrupting their UX.
6. User A navigates to a different file in the tree. Result: User A's bubble vanishes for User B, and User B's diff window automatically closes, returning them to their normal local editor view.
