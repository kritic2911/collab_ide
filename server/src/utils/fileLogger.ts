import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ──────────────────────────────────────────────
// File Logger — persistent log files that survive process restarts
//
// server.log   → all request/response + startup/shutdown events
// webhooks.log → GitHub webhook-specific events (receive, verify, store, broadcast)
//
// Both files are append-only. Entries are timestamped with ISO 8601.
// ──────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

function timestamp(): string {
  return new Date().toISOString();
}

function appendLine(fileName: string, line: string): void {
  try {
    const fullPath = path.join(SERVER_ROOT, fileName);
    fs.appendFileSync(fullPath, `[${timestamp()}] ${line}\n`, 'utf8');
  } catch {
    // Swallow file write errors — never crash the server for logging
  }
}

/**
 * General server log — requests, startup, errors.
 * Written to server/server.log
 */
export function serverLog(msg: string): void {
  appendLine('server.log', msg);
}

/**
 * Webhook-specific log — receive, signature check, persist, broadcast.
 * Written to server/webhooks.log AND mirrored to server.log.
 */
export function webhookLog(msg: string): void {
  appendLine('webhooks.log', msg);
  appendLine('server.log', `[WEBHOOK] ${msg}`);
}
