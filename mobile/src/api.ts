// HTTP client: configurable backend URL, bearer token from secure storage, offline-first reads backed by SQLite.
import * as SecureStore from 'expo-secure-store';
import { cacheGet, cacheSet, settingGet, settingSet } from './db';

export const DEFAULT_URL = 'http://10.0.2.2:8080';
let token: string | null = null;
let scope = 'anon';
export const setCacheScope = (userId: string) => { scope = userId; };
export const getToken = () => token;

export const getBaseUrl = () => settingGet('base_url') || DEFAULT_URL;
export const setBaseUrl = (u: string) => settingSet('base_url', u.trim().replace(/\/+$/, ''));

export async function loadToken() { token = await SecureStore.getItemAsync('jwt'); return token; }
export async function saveToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync('jwt', t); else await SecureStore.deleteItemAsync('jwt');
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

export async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 8000, tokenOverride?: string | null): Promise<T> {
  const auth = tokenOverride !== undefined ? tokenOverride : token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(getBaseUrl() + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection or the server address in Settings.');
  } finally { clearTimeout(timer); }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json && json.error ? json.error : { code: 'HTTP_' + res.status, message: 'Request failed', details: {} };
    throw new ApiError(res.status, e.code, friendly(e.code, e.message), e.details || {});
  }
  return json as T;
}

// Cached GET: returns fresh data when online, otherwise the last saved copy (flagged as offline).
export async function cachedGet<T>(path: string): Promise<{ data: T; offline: boolean; updated_at: string }> {
  try {
    const data = await request<T>('GET', path);
    cacheSet(scope + '|' + path, data);
    cacheSet('shared|' + path, data); // device-level fallback so another account on this phone can still open the screen offline
    return { data, offline: false, updated_at: new Date().toISOString() };
  } catch (e) {
    const c = cacheGet<T>(scope + '|' + path) || cacheGet<T>('shared|' + path);
    if (c && isNetworkError(e)) return { data: c.data, offline: true, updated_at: c.updated_at };
    throw e;
  }
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Please sign in again.', FORBIDDEN: 'Your role is not allowed to do this.',
  OUT_OF_STOCK: 'Sorry, this item just sold out.', PAYMENT_DECLINED: 'Your payment was declined. No money was taken.',
  PAYMENT_CAPTURE_FAILED: 'The payment could not be completed. No money was taken.', MATCH_NOT_IN_PROGRESS: 'This match is not in progress.',
  INVALID_COMPENSATION: 'That event was already corrected or cannot be corrected.', SQUAD_FULL: 'The destination squad is full.',
  TRANSFER_WINDOW_CLOSED: 'The transfer window is closed for that date.', NOT_IN_SQUAD: 'The player is no longer in this squad.',
  PLAYER_ON_LOAN: 'The player is currently on loan.', MIN_POSITION_VIOLATION: 'The squad would be left without enough players in that position.',
  CROSS_TENANT_TRANSFER: 'Players can only move between clubs of the same organisation.', INVALID_BASE_VERSION: 'Your copy was newer than the server’s; the action was not applied.',
  INNINGS_COMPLETE: 'This innings is complete.', SERIES_ALREADY_DECIDED: 'The series is already decided.', TIE_NOT_ALLOWED: 'Scores are level and this sport does not allow draws.',
  ILLEGAL_TRANSITION: 'That status change is not allowed now.', DUPLICATE_EVENT_ID: 'This action was already recorded differently on the server.',
  RATE_LIMITED: 'Too many requests. Please wait a few seconds.', VALIDATION_ERROR: 'Some information is missing or invalid.',
};
export const cacheKey = (path: string) => scope + '|' + path;
export const friendly = (code: string, fallback?: string) => MESSAGES[code] || fallback || 'Something went wrong. Please try again.';
