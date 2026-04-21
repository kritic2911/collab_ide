import { db } from '../db/client.js';

/**
 * Maps an array of user IDs to a dictionary of usernames.
 * Used for populating the Presence and Hydration state on the frontend.
 *
 * @param userIds {number[]} Array of user IDs to resolve.
 * @returns {Promise<Record<number, string>>} A map of userId -> username.
 */
export async function resolveUsernames(
  userIds: number[]
): Promise<Record<number, string>> {
  if (userIds.length === 0) return {};

  const { rows } = await db.query<{ id: number; username: string }>(
    'SELECT id, username FROM users WHERE id = ANY($1)',
    [userIds]
  );

  return Object.fromEntries(rows.map((u) => [u.id, u.username]));
}
