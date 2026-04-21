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
      content?: string;     // full editor content for peer sync
    }
  | {
      type: 'resolve_conflict';
      roomId: string;
      startLine: number;
      endLine: number;
      resolution: 'keep_mine' | 'keep_theirs' | 'manual';
    }
  | {
      type: 'chat_message';
      roomId: string;
      text: string;          // max 2000 chars, server-validated
    }
  | {
      type: 'chat_load_older';
      roomId: string;
      beforeId: number;      // cursor: load messages with id < this
    }
  | {
      type: 'chat_delete';
      roomId: string;
      messageId: number;     // PG serial id of the message to delete
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
      }[];
    }
  | {
      type: 'peer_joined';
      roomId: string;
      username: string;
      avatarUrl: string | null;
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
      content?: string;     // full editor content for peer sync
    }
  | {
      type: 'hydrate_state';
      roomId: string;
      base: string | null;                   // committed file content from D2
      diffs: { userId: number; username: string; patch: object }[]; // active peer diffs from D3
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
      type: 'conflict_detected';
      roomId: string;
      conflicts: {
        startLine: number;
        endLine: number;
        lines: number[];
        preview: { line: number; base: string; userA: string; userB: string }[];
        userA: { userId: string; username: string };
        userB: { userId: string; username: string };
      }[];
    }
  | {
      type: 'conflict_resolved';
      roomId: string;
      startLine: number;
      endLine: number;
      resolution: string;
      resolvedBy: string;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'chat_broadcast';
      roomId: string;
      messageId: number;       // PG serial id for dedup
      userId: number;
      username: string;
      avatarUrl: string | null;
      text: string;            // plaintext, decrypted server-side
      timestamp: number;
    }
  | {
      type: 'chat_history';
      roomId: string;
      messages: {
        id: number;
        userId: number;
        username: string;
        avatarUrl: string | null;
        text: string;
        timestamp: number;
      }[];
    }
  | {
      type: 'chat_older_history';
      roomId: string;
      messages: {
        id: number;
        userId: number;
        username: string;
        avatarUrl: string | null;
        text: string;
        timestamp: number;
      }[];
      hasMore: boolean;       // false when no older messages remain
    }
  | {
      type: 'chat_deleted';
      roomId: string;
      messageId: number;     // which message was removed
      deletedBy: number;     // userId who deleted it
    };
