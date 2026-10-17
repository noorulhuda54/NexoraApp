// Offline queue + sync engine. Actions use the exact Section 5.14 format and are replayed via POST /api/v1/sync.
import NetInfo from '@react-native-community/netinfo';
import { request, getBaseUrl, getToken } from './api';
import { enqueue, markResult, pendingActions, settingGet, settingSet } from './db';

export type SyncState = { online: boolean; syncing: boolean; pending: number; lastMessage: string | null };
let state: SyncState = { online: true, syncing: false, pending: 0, lastMessage: null };
const listeners = new Set<(s: SyncState) => void>();
const emit = (patch: Partial<SyncState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export const getSyncState = () => state;
export function subscribe(l: (s: SyncState) => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function deviceId() {
  let id = settingGet('device_id');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); settingSet('device_id', id); }
  return id;
}
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function refreshPending() { emit({ pending: pendingActions().length }); }

let currentEmail: string | null = null;
export const setSyncUser = (email: string | null) => { currentEmail = email; };
export function queueAction(type: 'score_event' | 'roster_transfer', payload: unknown, baseVersion: number, label: string) {
  enqueue({ action_id: newId('act'), type, base_version: baseVersion, payload, label, token: getToken(), user_email: currentEmail });
  refreshPending();
  if (state.online) void syncNow();
}

type SyncResult = { action_id: string; status: string; resolution: string; error_code: string | null };
export async function syncNow(): Promise<SyncResult[] | null> {
  const actions = pendingActions();
  if (!actions.length || state.syncing) { refreshPending(); return null; }
  emit({ syncing: true });
  try {
    // one request per author (actions keep the token of the user who queued them), oldest author group first
    const groups = new Map<string, typeof actions>();
    for (const a of actions) { const k = a.token || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(a); }
    const all: SyncResult[] = [];
    const s = { applied: 0, rejected: 0, duplicate: 0 };
    for (const [tok, list] of groups) {
      const body = { device_id: deviceId(), actions: list.map((a) => ({ action_id: a.action_id, type: a.type, queued_at: a.queued_at, base_version: a.base_version, payload: JSON.parse(a.payload) })) };
      const res = await request<{ results: SyncResult[]; summary: { applied: number; rejected: number; duplicate: number } }>('POST', '/api/v1/sync', body, 15000, tok || null);
      for (const r of res.results) markResult(r.action_id, r.status, r.resolution, r.error_code);
      s.applied += res.summary.applied; s.rejected += res.summary.rejected; s.duplicate += res.summary.duplicate;
      all.push(...res.results);
    }
    emit({ syncing: false, online: true, lastMessage: `Synced: ${s.applied} applied, ${s.rejected} rejected, ${s.duplicate} already on server.` });
    refreshPending();
    return all;
  } catch (e) {
    emit({ syncing: false, lastMessage: 'Sync failed — will retry when the connection returns.' });
    refreshPending();
    return null;
  }
}

// Reachability = device network up AND backend /health answers.
async function probe() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(getBaseUrl() + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}
let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;
  refreshPending();
  const check = async (connected: boolean | null) => {
    const online = connected === false ? false : await probe();
    const wasOffline = !state.online;
    emit({ online });
    if (online && (wasOffline || pendingActions().length)) void syncNow();
  };
  NetInfo.addEventListener((s) => { void check(s.isConnected); });
  setInterval(() => { void NetInfo.fetch().then((s) => check(s.isConnected)); }, 10000);
}
