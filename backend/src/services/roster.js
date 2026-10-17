'use strict';
// Section 5.11 — roster scenarios, transfers/loans/releases with ordered rule checks and immutable audit trail.
const { err, vErr, isId, isObj, isInt, isDate, addDays, nowIso, today, canonical, clone } = require('../lib');
const { S, put, nextCounter } = require('../state');
const db = require('../db');

const ROLES = ['captain', 'vice_captain', 'starter', 'substitute'];

function setup(b) {
  const f = [];
  const L = b.league;
  if (!isObj(L) || !isId(L.league_id) || !isId(L.tenant_id) || !isId(L.sport_id)) f.push('league');
  else {
    const w = L.transfer_window;
    if (!isObj(w) || !isDate(w.open) || !isDate(w.close) || w.open > w.close) f.push('league.transfer_window');
    if (L.max_squad_size !== undefined && L.max_squad_size !== null && !(isInt(L.max_squad_size) && L.max_squad_size >= 1)) f.push('league.max_squad_size');
    if (L.required_positions !== undefined && L.required_positions !== null && (!isObj(L.required_positions) || Object.values(L.required_positions).some((v) => !isInt(v) || v < 0))) f.push('league.required_positions');
  }
  const squads = b.squads === undefined ? [] : b.squads;
  if (!Array.isArray(squads) || squads.some((s) => !isObj(s) || !isId(s.squad_id) || (s.club_id !== undefined && s.club_id !== null && !isId(s.club_id)) || !isId(s.tenant_id))
      || new Set(squads.map((s) => s && s.squad_id)).size !== squads.length) f.push('squads');
  const squadIds = new Set(Array.isArray(squads) ? squads.map((s) => s && s.squad_id) : []);
  const players = b.players === undefined ? [] : b.players;
  if (!Array.isArray(players) || players.some((p) => !isObj(p) || !isId(p.player_id) || (p.squad_id !== null && p.squad_id !== undefined && !squadIds.has(p.squad_id))
      || (p.role !== undefined && p.role !== null && !ROLES.includes(p.role)) || (p.position !== undefined && p.position !== null && typeof p.position !== 'string'))
      || new Set(players.map((p) => p && p.player_id)).size !== players.length) f.push('players');
  const mip = b.matches_in_progress === undefined || b.matches_in_progress === null ? [] : b.matches_in_progress;
  if (!Array.isArray(mip) || mip.some((m) => !isObj(m) || !isId(m.match_id))) f.push('matches_in_progress');
  if (f.length) throw vErr(f);
  const sport = S.sports.get(L.sport_id);
  if (!sport) throw err(404, 'SPORT_NOT_FOUND', `Sport ${L.sport_id} not found.`, { sport_id: L.sport_id });
  // replace this league's roster state
  const old = S.rosterLeagues.get(L.league_id);
  if (old) for (const pid of old.player_ids) { const r = S.registry.get(pid); if (r) { delete r.leagues[L.league_id]; put('registry', pid, r); } }
  const league = {
    league_id: L.league_id, tenant_id: L.tenant_id, sport_id: L.sport_id, transfer_window: { open: L.transfer_window.open, close: L.transfer_window.close },
    max_squad_size: L.max_squad_size ?? sport.roster.max_squad_size, required_positions: L.required_positions ?? sport.roster.required_positions,
    squad_ids: squads.map((s) => s.squad_id), player_ids: players.map((p) => p.player_id), matches_in_progress: clone(mip),
  };
  for (const s of squads) put('squads', s.squad_id, { squad_id: s.squad_id, club_id: s.club_id || null, tenant_id: s.tenant_id, name: s.name || s.squad_id, league_id: L.league_id });
  for (const p of players) {
    const r = S.registry.get(p.player_id) || { player_id: p.player_id, leagues: {} };
    r.name = p.name || r.name || p.player_id; r.position = p.position || null;
    r.leagues[L.league_id] = {
      registration: p.squad_id ? { player_id: p.player_id, league_id: L.league_id, squad_id: p.squad_id, parent_squad_id: null, registration_type: 'initial', start_date: L.transfer_window.open, loan_end_date: null, role: p.role || 'substitute' } : null,
      history: [], last_league_touch: nowIso(),
      initial: p.squad_id ? { squad_id: p.squad_id, parent_squad_id: null } : null,
    };
    r.last_league = L.league_id;
    put('registry', p.player_id, r);
  }
  put('rosterLeagues', L.league_id, league);
  const counts = {};
  for (const s of squads) counts[s.squad_id] = squadCount(league, s.squad_id);
  return { league_id: L.league_id, status: 'configured', squad_counts: counts };
}

function squadCount(league, squadId) {
  let n = 0;
  for (const pid of league.player_ids) { const reg = regOf(pid, league.league_id); if (reg && reg.squad_id === squadId) n++; }
  return n;
}
function positionCount(league, squadId, position, excludePid) {
  let n = 0;
  for (const pid of league.player_ids) {
    if (pid === excludePid) continue;
    const reg = regOf(pid, league.league_id);
    if (reg && reg.squad_id === squadId && (S.registry.get(pid) || {}).position === position) n++;
  }
  return n;
}
const regOf = (pid, lid) => { const r = S.registry.get(pid); return r && r.leagues[lid] ? r.leagues[lid].registration : null; };

// Automatic loan return: the day after loan_end_date the player is back with the lender (written once).
function applyLoanReturns(pid, asOf) {
  const r = S.registry.get(pid);
  if (!r) return;
  for (const [lid, st] of Object.entries(r.leagues)) {
    const reg = st.registration;
    if (reg && reg.registration_type === 'loan' && reg.loan_end_date && asOf > reg.loan_end_date) {
      const back = addDays(reg.loan_end_date, 1);
      const entry = auditEntry('loan_return', pid, lid, reg.squad_id, reg.parent_squad_id, back, 'active', 'system', 'Loan period ended');
      st.registration = { player_id: pid, league_id: lid, squad_id: reg.parent_squad_id, parent_squad_id: null, registration_type: 'loan_return', start_date: back, loan_end_date: null, role: 'substitute' };
      st.history.push(entry);
      r.last_league = lid;
      put('registry', pid, r);
      db.appendAudit(entry);
    }
  }
}

function virtualReg(reg, date) {
  if (reg && reg.registration_type === 'loan' && reg.loan_end_date && date > reg.loan_end_date) {
    return { ...reg, squad_id: reg.parent_squad_id, parent_squad_id: null, registration_type: 'loan_return', loan_end_date: null, role: 'substitute' };
  }
  return reg;
}

// Squad membership on a given date, replayed from the immutable audit trail.
function squadAsOf(st, date) {
  let cur = st.initial ? { squad_id: st.initial.squad_id, parent_squad_id: null } : null;
  for (const e of st.history) {
    if (e.effective_date > date) continue;
    if (e.action === 'release') cur = null;
    else if (e.action === 'loan') cur = { squad_id: e.to_squad_id, parent_squad_id: e.from_squad_id };
    else cur = { squad_id: e.to_squad_id, parent_squad_id: null };
  }
  return cur;
}

function auditEntry(action, pid, lid, from, to, eff, stateName, who, why) {
  return { audit_id: 'au-' + String(nextCounter('audit')).padStart(4, '0'), action, player_id: pid, league_id: lid, from_squad_id: from ?? null,
    to_squad_id: to ?? null, effective_date: eff, state: stateName, who, when: nowIso(), why };
}

function validateTransfer(b) {
  const f = [];
  if (!isId(b.request_id)) f.push('request_id');
  if (!isId(b.league_id)) f.push('league_id');
  if (!isId(b.player_id)) f.push('player_id');
  if (!['transfer', 'loan', 'release'].includes(b.type)) f.push('type');
  if (!isId(b.from_squad_id)) f.push('from_squad_id');
  if (b.type !== 'release' && !isId(b.to_squad_id)) f.push('to_squad_id');
  if (b.type === 'release' && b.to_squad_id !== undefined && b.to_squad_id !== null && !isId(b.to_squad_id)) f.push('to_squad_id');
  if (!isDate(b.effective_date)) f.push('effective_date');
  if (b.type === 'loan') { if (!isDate(b.loan_end_date) || (isDate(b.effective_date) && b.loan_end_date <= b.effective_date)) f.push('loan_end_date'); }
  else if (b.loan_end_date !== undefined && b.loan_end_date !== null && !isDate(b.loan_end_date)) f.push('loan_end_date');
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') f.push('reason');
  if (b.requested_by !== undefined && b.requested_by !== null && typeof b.requested_by !== 'string') f.push('requested_by');
  return f;
}
const transferFp = (b) => canonical({ request_id: b.request_id, league_id: b.league_id, player_id: b.player_id, type: b.type, from_squad_id: b.from_squad_id,
  to_squad_id: b.type === 'release' ? null : b.to_squad_id, effective_date: b.effective_date, loan_end_date: b.type === 'loan' ? b.loan_end_date : null,
  reason: b.reason ?? null, requested_by: b.requested_by ?? null });

function transfer(b) {
  const f = validateTransfer(b);
  if (f.length) throw vErr(f);
  const prior = S.transferReqs.get(b.request_id);
  if (prior) {
    if (prior.fp === transferFp(b)) return { status: 200, body: prior.response, duplicate: true };
    throw err(409, 'DUPLICATE_REQUEST_ID', `Request ${b.request_id} already used with a different body.`, { request_id: b.request_id });
  }
  const league = S.rosterLeagues.get(b.league_id);
  if (!league) throw err(404, 'LEAGUE_NOT_FOUND', `League ${b.league_id} not found.`, { league_id: b.league_id });
  const r = S.registry.get(b.player_id);
  if (!r) throw err(404, 'PLAYER_NOT_FOUND', `Player ${b.player_id} not found.`, { player_id: b.player_id });
  const from = S.squads.get(b.from_squad_id);
  if (!from) throw err(404, 'SQUAD_NOT_FOUND', `Squad ${b.from_squad_id} not found.`, { squad_id: b.from_squad_id });
  const to = b.type === 'release' ? null : S.squads.get(b.to_squad_id);
  if (b.type !== 'release' && !to) throw err(404, 'SQUAD_NOT_FOUND', `Squad ${b.to_squad_id} not found.`, { squad_id: b.to_squad_id });
  if (from.tenant_id !== league.tenant_id || (to && to.tenant_id !== league.tenant_id)) {
    throw err(409, 'CROSS_TENANT_TRANSFER', 'Squads must belong to the league tenant.', { league_id: league.league_id, tenant_id: league.tenant_id, squad_id: from.tenant_id !== league.tenant_id ? from.squad_id : to.squad_id });
  }
  const reg = virtualReg(regOf(b.player_id, b.league_id), b.effective_date);
  if (!reg || reg.squad_id !== b.from_squad_id) throw err(409, 'NOT_IN_SQUAD', `Player ${b.player_id} is not in squad ${b.from_squad_id}.`, { player_id: b.player_id, squad_id: b.from_squad_id, current_squad_id: reg ? reg.squad_id : null });
  if (b.type !== 'release' && (b.effective_date < league.transfer_window.open || b.effective_date > league.transfer_window.close)) {
    throw err(409, 'TRANSFER_WINDOW_CLOSED', 'Effective date is outside the transfer window.', { effective_date: b.effective_date, open: league.transfer_window.open, close: league.transfer_window.close });
  }
  if (reg.registration_type === 'loan') throw err(409, 'PLAYER_ON_LOAN', `Player ${b.player_id} is on loan.`, { player_id: b.player_id, parent_squad_id: reg.parent_squad_id });
  if (b.type !== 'release' && squadCount(league, b.to_squad_id) + 1 > league.max_squad_size) {
    throw err(409, 'SQUAD_FULL', `Squad ${b.to_squad_id} is full.`, { squad_id: b.to_squad_id, max_squad_size: league.max_squad_size });
  }
  const pos = r.position;
  const need = pos && league.required_positions ? league.required_positions[pos] : undefined;
  if (need !== undefined && positionCount(league, b.from_squad_id, pos, b.player_id) < need) {
    throw err(409, 'MIN_POSITION_VIOLATION', `Squad ${b.from_squad_id} would have fewer than ${need} ${pos}.`, { squad_id: b.from_squad_id, position: pos, required: need });
  }
  // accepted — materialise any loan return that happened before this move
  applyLoanReturns(b.player_id, b.effective_date);
  const blocking = (league.matches_in_progress || []).find((m) => m.home_squad_id === b.from_squad_id || m.away_squad_id === b.from_squad_id);
  const stateName = blocking ? 'deferred_until_match_end' : 'active';
  const st = r.leagues[b.league_id];
  let registration = null;
  if (b.type === 'transfer') registration = { player_id: b.player_id, league_id: b.league_id, squad_id: b.to_squad_id, parent_squad_id: null, registration_type: 'transfer', start_date: b.effective_date, loan_end_date: null, role: 'substitute' };
  else if (b.type === 'loan') registration = { player_id: b.player_id, league_id: b.league_id, squad_id: b.to_squad_id, parent_squad_id: b.from_squad_id, registration_type: 'loan', start_date: b.effective_date, loan_end_date: b.loan_end_date, role: 'substitute' };
  const entry = auditEntry(b.type, b.player_id, b.league_id, b.from_squad_id, b.type === 'release' ? null : b.to_squad_id, b.effective_date, stateName, b.requested_by ?? null, b.reason ?? null);
  st.registration = registration;
  st.history.push(entry);
  r.last_league = b.league_id;
  put('registry', b.player_id, r);
  db.appendAudit(entry);
  const response = { request_id: b.request_id, status: 'accepted', state: stateName, blocking_match_id: blocking ? blocking.match_id : null, registration: clone(registration), audit_entry: clone(entry) };
  put('transferReqs', b.request_id, { fp: transferFp(b), response });
  try { require('../queue').publish('roster.changed', { player_id: b.player_id, league_id: b.league_id, action: b.type }); } catch (e) { /* ignore */ }
  return { status: 201, body: response };
}

function history(playerId, asOf) {
  if (asOf !== undefined && !isDate(asOf)) throw vErr(['as_of']);
  const r = S.registry.get(playerId);
  if (!r) throw err(404, 'PLAYER_NOT_FOUND', `Player ${playerId} not found.`, { player_id: playerId });
  const date = asOf || today();
  applyLoanReturns(playerId, date);
  const lid = r.last_league || Object.keys(r.leagues)[0] || null;
  const st = lid ? r.leagues[lid] : null;
  const cur = st ? (st.initial !== undefined ? squadAsOf(st, date) : st.registration) : null;
  const all = [];
  for (const s of Object.values(r.leagues)) all.push(...s.history);
  all.sort((a, b) => (a.audit_id < b.audit_id ? -1 : 1));
  return { player_id: playerId, as_of: date, league_id: lid, current_squad_id: cur ? cur.squad_id : null, parent_squad_id: cur ? cur.parent_squad_id : null, history: all };
}

function auditCount(playerId) {
  const r = S.registry.get(playerId);
  if (!r) return 0;
  return Object.values(r.leagues).reduce((n, s) => n + s.history.length, 0);
}

module.exports = { setup, transfer, history, validateTransfer, transferFp, auditCount, applyLoanReturns };
