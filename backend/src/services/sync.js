'use strict';
// Section 5.14 — offline action replay with per-action conflict resolution (server wins).
const { vErr, isId, isObj, isInt, ApiError } = require('../lib');
const { S, put } = require('../state');
const matches = require('./matches');
const roster = require('./roster');

function validateEnvelope(b) {
  const f = [];
  if (!isId(b.device_id)) f.push('device_id');
  if (!Array.isArray(b.actions) || b.actions.length < 1 || b.actions.length > 100) f.push('actions');
  else if (b.actions.some((a) => !isObj(a) || !isId(a.action_id) || !['score_event', 'roster_transfer'].includes(a.type)
    || typeof a.queued_at !== 'string' || isNaN(Date.parse(a.queued_at)) || !isInt(a.base_version) || a.base_version < 0 || !isObj(a.payload))) f.push('actions');
  if (f.length) throw vErr(f);
}

function sync(b, opts = {}) {
  validateEnvelope(b);
  const order = b.actions.map((a, i) => ({ a, i })).sort((x, y) => Date.parse(x.a.queued_at) - Date.parse(y.a.queued_at) || x.i - y.i);
  const results = new Array(b.actions.length);
  const summary = { applied: 0, rejected: 0, duplicate: 0 };
  order.forEach(({ a, i }, k) => {
    const res = opts.allowed && !opts.allowed[i] ? forbidden(b.device_id, a) : processOne(b.device_id, a);
    results[i] = { action_id: a.action_id, status: res.status, resolution: res.resolution, error_code: res.error_code || null, processed_order: k + 1, server_version: res.server_version, signature: res.signature || null };
    summary[res.status]++;
  });
  return { device_id: b.device_id, results, summary };
}

function forbidden(deviceId, a) {
  const key = deviceId + '|' + a.action_id;
  if (S.syncActions.has(key)) return { status: 'duplicate', resolution: 'skipped_duplicate', server_version: 0 };
  put('syncActions', key, { device_id: deviceId, action_id: a.action_id, status: 'rejected', error_code: 'FORBIDDEN' });
  return { status: 'rejected', resolution: 'server_wins', error_code: 'FORBIDDEN', server_version: 0 };
}

function processOne(deviceId, a) {
  const key = deviceId + '|' + a.action_id;
  const version = () => {
    if (a.type === 'score_event') { const m = S.matches.get(a.payload.match_id); return m ? m.events.length : 0; }
    return roster.auditCount(a.payload.player_id);
  };
  if (S.syncActions.has(key)) return { status: 'duplicate', resolution: 'skipped_duplicate', server_version: version() };
  const done = (r) => { put('syncActions', key, { device_id: deviceId, action_id: a.action_id, status: r.status, error_code: r.error_code || null }); return r; };
  const reject = (code) => done({ status: 'rejected', resolution: 'server_wins', error_code: code, server_version: version() });
  const p = a.payload;
  if (a.type === 'score_event') {
    if (matches.validateEvent(p).length) return reject('VALIDATION_ERROR');
    const existing = matches.findEvent(p.event_id);
    if (existing && existing._fp === matches.fingerprint(p)) return done({ status: 'duplicate', resolution: 'skipped_duplicate', server_version: version() });
    if (p.type !== 'match_init' && !S.matches.has(p.match_id)) return reject('MATCH_NOT_FOUND');
    if (a.base_version > version()) return reject('INVALID_BASE_VERSION');
    const base = version();
    try {
      const r = matches.appendEvent(p);
      return done({ status: 'applied', resolution: a.base_version === base ? 'appended' : 'rebased_append', server_version: version(), signature: r.body.signature });
    } catch (e) { if (e instanceof ApiError) return reject(e.code); throw e; }
  }
  if (roster.validateTransfer(p).length) return reject('VALIDATION_ERROR');
  const prior = S.transferReqs.get(p.request_id);
  if (prior && prior.fp === roster.transferFp(p)) return done({ status: 'duplicate', resolution: 'skipped_duplicate', server_version: version() });
  if (!S.rosterLeagues.has(p.league_id)) return reject('LEAGUE_NOT_FOUND');
  if (!S.registry.has(p.player_id)) return reject('PLAYER_NOT_FOUND');
  if (!S.squads.has(p.from_squad_id) || (p.type !== 'release' && !S.squads.has(p.to_squad_id))) return reject('SQUAD_NOT_FOUND');
  if (a.base_version > version()) return reject('INVALID_BASE_VERSION');
  const base = version();
  try {
    roster.transfer(p);
    return done({ status: 'applied', resolution: a.base_version === base ? 'appended' : 'rebased_append', server_version: version() });
  } catch (e) { if (e instanceof ApiError) return reject(e.code); throw e; }
}

module.exports = { sync };
