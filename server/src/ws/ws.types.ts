import type { WebSocket } from '@fastify/websocket';
import type { JwtPayload } from '../auth/jwt.js';

// ──────────────────────────────────────────────
// Authenticated WebSocket — every connection in a room carries user info
// ──────────────────────────────────────────────
export type AuthenticatedSocket = WebSocket & { user: JwtPayload };

// ──────────────────────────────────────────────
// DiffPatch — maps 1:1 to Monaco's IModelContentChange
// ──────────────────────────────────────────────
export type DiffPatch = {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;        // replacement text ("" = deletion)
  rangeLength: number; // chars replaced, needed for OT conflict detection later
};

// ──────────────────────────────────────────────
// Client → Server messages
// ──────────────────────────────────────────────
export type ClientMessage =
  | {
      type: 'join_room';
      repoId: string;
      branch: string;
      filePath: string; // e.g. "src/components/Editor.tsx"
      content: string;  // user's current editor content
    }
  | {
      type: 'leave_room';
      roomId: string;   // server-computed ID, received in room_joined
    }
  | {
      type: 'diff_update';
      roomId: string;
      patches: DiffPatch[]; // array — Monaco batches rapid changes
      seq: number;          // monotonic counter per client, for ordering
    }
  | {
      type: 'request_peer_content';
      roomId: string;
      username: string;     // peer whose document we want
    };

// ──────────────────────────────────────────────
// Server → Client messages
// ──────────────────────────────────────────────
export type ServerMessage =
  | {
      type: 'room_joined';
      roomId: string;
      peers: {
        username: string;
        avatarUrl: string | null;
        currentContent: string;
        seq: number;
      }[];
    }
  | {
      type: 'peer_joined';
      roomId: string;
      username: string;
      avatarUrl: string | null;
      currentContent: string;
      seq: number;
    }
  | {
      type: 'peer_left';
      roomId: string;
      username: string;
    }
  | {
      type: 'peer_diff';
      roomId: string;
      username: string;
      patches: DiffPatch[];
      seq: number;
    }
  | {
      type: 'remote_push';
      roomId: string;
      pushedBy: string;
      branch: string;
      changedFiles: string[];
      commitSha: string; // short SHA for the banner: "abc1234 pushed to main"
    }
  | {
      type: 'peer_content';
      roomId: string;
      username: string;
      content: string;
    };
