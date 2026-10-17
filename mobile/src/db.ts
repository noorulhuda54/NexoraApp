// Local SQLite persistence: cached API responses (fixtures, standings, clubs, matches) and the offline action queue.
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('nascon.db');
db.execSync(`
  CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS queue (
    action_id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, queued_at TEXT NOT NULL, base_version INTEGER NOT NULL,
    payload TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error_code TEXT, resolution TEXT, synced_at TEXT,
    token TEXT, user_email TEXT);
`);

export function cacheSet(key: string, value: unknown) {
  db.runSync('INSERT OR REPLACE INTO cache (key, json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), new Date().toISOString());
}
export function cacheGet<T>(key: string): { data: T; updated_at: string } | null {
  const row = db.getFirstSync<{ json: string; updated_at: string }>('SELECT json, updated_at FROM cache WHERE key = ?', key);
  return row ? { data: JSON.parse(row.json) as T, updated_at: row.updated_at } : null;
}
export function settingGet(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}
export function settingSet(key: string, value: string) {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export type QueuedAction = {
  action_id: string; type: 'score_event' | 'roster_transfer'; queued_at: string; base_version: number;
  payload: string; label: string; status: 'pending' | 'applied' | 'rejected' | 'duplicate'; error_code: string | null; resolution: string | null; synced_at: string | null;
  token: string | null; user_email: string | null;
};
// Each action keeps the token of the user who queued it, so accounts can be switched offline without losing authorship.
export function enqueue(a: { action_id: string; type: QueuedAction['type']; base_version: number; payload: unknown; label: string; token: string | null; user_email: string | null }) {
  db.runSync('INSERT INTO queue (action_id, type, queued_at, base_version, payload, label, token, user_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    a.action_id, a.type, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), a.base_version, JSON.stringify(a.payload), a.label, a.token, a.user_email);
}
export const pendingActions = () => db.getAllSync<QueuedAction>("SELECT * FROM queue WHERE status = 'pending' ORDER BY queued_at, rowid");
export const recentResults = () => db.getAllSync<QueuedAction>("SELECT * FROM queue WHERE status != 'pending' ORDER BY synced_at DESC LIMIT 20");
export function markResult(actionId: string, status: string, resolution: string, errorCode: string | null) {
  db.runSync('UPDATE queue SET status = ?, resolution = ?, error_code = ?, synced_at = ? WHERE action_id = ?', status, resolution, errorCode, new Date().toISOString(), actionId);
}
export function clearAll() { db.execSync('DELETE FROM cache; DELETE FROM queue;'); }
