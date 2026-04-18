import { encrypt, decrypt } from '../auth/crypto.js';
import { db } from '../db/client.js';

// ──────────────────────────────────────────────
// Chat Service — encrypted persistence in PostgreSQL
//
// Messages are AES-256-CBC encrypted at rest using the
// same ENCRYPTION_KEY that protects GitHub tokens.
// Decryption happens server-side before sending to clients.
// ──────────────────────────────────────────────

export interface ChatEntry {
  id: number;
  userId: number;
  username: string;
  avatarUrl: string | null;
  text: string;        // plaintext (decrypted)
  timestamp: number;   // Unix ms
}

/**
 * Persist a new chat message (encrypts before INSERT).
 *
 * @param roomId   The room identifier (repoId:branch:filePath)
 * @param userId   The sender's user ID
 * @param username The sender's username (denormalized snapshot)
 * @param avatarUrl The sender's avatar URL (denormalized snapshot)
 * @param text     Plaintext message body
 * @returns The saved ChatEntry with server-assigned id and timestamp
 */
export async function saveMessage(
  roomId: string,
  userId: number,
  username: string,
  avatarUrl: string | null,
  text: string
): Promise<ChatEntry> {
  const ciphertext = encrypt(text);

  const result = await db.query<{ id: number; created_at: Date }>(
    `INSERT INTO chat_messages (room_id, user_id, username, avatar_url, message_enc)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [roomId, userId, username, avatarUrl, ciphertext]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    userId,
    username,
    avatarUrl,
    text,
    timestamp: row.created_at.getTime(),
  };
}

/**
 * Fetch chat history for a room — last 7 days, decrypted.
 *
 * Messages are returned in chronological order (oldest first)
 * so the client can render them top-to-bottom naturally.
 *
 * @param roomId The room identifier
 * @param limit  Maximum number of messages to return (default 50)
 * @returns Array of ChatEntry in chronological order
 */
export async function getHistory(
  roomId: string,
  limit: number = 50
): Promise<ChatEntry[]> {
  const result = await db.query<{
    id: number;
    user_id: number;
    username: string;
    avatar_url: string | null;
    message_enc: string;
    created_at: Date;
  }>(
    `SELECT id, user_id, username, avatar_url, message_enc, created_at
     FROM chat_messages
     WHERE room_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at ASC
     LIMIT $2`,
    [roomId, limit]
  );

  const entries: ChatEntry[] = [];

  for (const row of result.rows) {
    try {
      const plaintext = decrypt(row.message_enc);
      entries.push({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        avatarUrl: row.avatar_url,
        text: plaintext,
        timestamp: row.created_at.getTime(),
      });
    } catch {
      // Corrupted or re-keyed entry — skip silently
      console.error(`[ChatService] Failed to decrypt message id=${row.id}`);
    }
  }

  return entries;
}

/**
 * Fetch older messages before a given message id (cursor-based pagination).
 * Capped at 30 days — messages older than that are cleaned up.
 *
 * @param roomId   The room identifier
 * @param beforeId The message id to paginate before (exclusive)
 * @param limit    Maximum number of messages to return (default 30)
 * @returns Array of ChatEntry in chronological order (oldest first)
 */
export async function getOlderMessages(
  roomId: string,
  beforeId: number,
  limit: number = 30
): Promise<ChatEntry[]> {
  const result = await db.query<{
    id: number;
    user_id: number;
    username: string;
    avatar_url: string | null;
    message_enc: string;
    created_at: Date;
  }>(
    `SELECT id, user_id, username, avatar_url, message_enc, created_at
     FROM chat_messages
     WHERE room_id = $1
       AND id < $2
       AND created_at >= NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC
     LIMIT $3`,
    [roomId, beforeId, limit]
  );

  const entries: ChatEntry[] = [];

  // Reverse to return in chronological order (oldest first)
  for (const row of result.rows.reverse()) {
    try {
      const plaintext = decrypt(row.message_enc);
      entries.push({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        avatarUrl: row.avatar_url,
        text: plaintext,
        timestamp: row.created_at.getTime(),
      });
    } catch {
      console.error(`[ChatService] Failed to decrypt message id=${row.id}`);
    }
  }

  return entries;
}

/**
 * Delete a message by id — only if the requesting user owns it.
 *
 * @param messageId The PG serial id of the message to delete
 * @param userId    The requesting user's id (ownership check)
 * @returns true if deleted, false if not found or not owned
 */
export async function deleteMessage(
  messageId: number,
  userId: number
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM chat_messages WHERE id = $1 AND user_id = $2`,
    [messageId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
