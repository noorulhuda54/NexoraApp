'use strict';
const crypto = require('crypto');

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status; this.code = code; this.details = details || {};
  }
}
const err = (status, code, message, details) => new ApiError(status, code, message, details);
const vErr = (fields, message) => err(400, 'VALIDATION_ERROR', message || 'Validation failed', { fields: [].concat(fields) });

// Section 5.3 canonical JSON: sorted keys (code point order), no whitespace, non-ASCII unescaped.
function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  return JSON.stringify(v);
}
// JS key sort by UTF-16 units differs from code points only for astral chars; handle that exactly.
function cpCompare(a, b) {
  const A = Array.from(a), B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i].codePointAt(0), y = B[i].codePointAt(0);
    if (x !== y) return x - y;
  }
  return A.length - B.length;
}
function canonicalCP(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonicalCP).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(cpCompare);
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalCP(v[k])).join(',') + '}';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  return JSON.stringify(v);
}

function salt() { return process.env.DAY1_SALT || ''; }
function sign(id, payload, s) {
  const key = s !== undefined ? s : salt();
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.from(id + '|' + canonicalCP(payload), 'utf8')).digest('hex');
}
function lotsKey(seed, leagueId, teamId) {
  return crypto.createHash('sha256').update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}

// ---- minimal HS256 JWT ----
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwtSecret = () => process.env.JWT_SECRET || ('jwt:' + salt() + ':nascon-dev-secret');
function jwtSign(claims, ttlSec = 12 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec }));
  const s = b64u(crypto.createHmac('sha256', jwtSecret()).update(h + '.' + p).digest());
  return `${h}.${p}.${s}`;
}
function jwtVerify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
    if (!header || header.alg !== 'HS256') return null;
    const expect = b64u(crypto.createHmac('sha256', jwtSecret()).update(parts[0] + '.' + parts[1]).digest());
    const a = Buffer.from(expect), b = Buffer.from(parts[2]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (e) { return null; }
}

// ---- validation helpers ----
const ID_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}
function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const today = () => new Date().toISOString().slice(0, 10);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

module.exports = { ApiError, err, vErr, canonical: canonicalCP, canonicalSimple: canonical, sign, lotsKey, jwtSign, jwtVerify,
  isId, isInt, isObj, isDate, addDays, nowIso, today, clone, round3, salt };
