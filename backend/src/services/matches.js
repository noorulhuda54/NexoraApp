'use strict';
// Section 5.9 — append-only event-sourced match streams; projections are rebuilt from the log on every read.
const { err, vErr, isId, isObj, isInt, sign, canonical, clone, nowIso } = require('../lib');
const { S, put, touch } = require('../state');
const db = require('../db');

const TYPES = ['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation'];
const COMPENSABLE = ['score', 'discipline', 'tiebreak_winner'];

function newStream(match_id, sport_id, home, away, league_id, extra = {}) {
  return { match_id, sport_id, league_id: league_id || null, home_team_id: home, away_team_id: away, events: [], ...extra };
}

function validateEvent(b) {
  const f = [];
  if (!isId(b.event_id)) f.push('event_id');
  if (!isId(b.match_id)) f.push('match_id');
  if (!TYPES.includes(b.type)) f.push('type');
  const p = b.payload === undefined ? {} : b.payload;
  if (!isObj(p)) f.push('payload');
  if (f.length) return f;
  switch (b.type) {
    case 'match_init':
      if (!isId(p.sport_id)) f.push('payload.sport_id');
      if (!isId(p.home_team_id)) f.push('payload.home_team_id');
      if (!isId(p.away_team_id)) f.push('payload.away_team_id');
      if (isId(p.home_team_id) && p.home_team_id === p.away_team_id) f.push('payload.away_team_id');
      if (p.league_id !== undefined && p.league_id !== null && !isId(p.league_id)) f.push('payload.league_id');
      break;
    case 'score':
      if (!isId(p.team_id)) f.push('payload.team_id');
      if (typeof p.event_type !== 'string' || !p.event_type) f.push('payload.event_type');
      break;
    case 'discipline':
      if (!isId(p.team_id)) f.push('payload.team_id');
      if (!isInt(p.points)) f.push('payload.points');
      break;
    case 'tiebreak_winner':
      if (!isId(p.team_id)) f.push('payload.team_id');
      break;
    case 'compensation':
      if (!isId(p.compensates)) f.push('payload.compensates');
      if (p.reason !== undefined && p.reason !== null && typeof p.reason !== 'string') f.push('payload.reason');
      break;
    default:
  }
  return f;
}

// Projection over the log: which events are compensated, team tallies, status.
function project(m) {
  const sport = S.sports.get(m.sport_id) || {};
  const compensatedBy = new Map();
  for (const e of m.events) if (e.type === 'compensation') compensatedBy.set(e.payload.compensates, e.event_id);
  const model = sport.scoring_model;
  const per = sport.periods || {};
  const t = {};
  for (const side of ['home', 'away']) t[side] = { team_id: m[side + '_team_id'], score: 0, wickets: 0, balls: 0, fair_play: 0 };
  const sideOf = (team) => (team === m.home_team_id ? 'home' : team === m.away_team_id ? 'away' : null);
  let status = 'upcoming';
  let tiebreak = null;
  for (const e of m.events) {
    if (e.type === 'match_start') status = 'in_progress';
    else if (e.type === 'match_end') status = 'completed';
    if (compensatedBy.has(e.event_id) || e.type === 'compensation') continue;
    const s = sideOf(e.payload.team_id);
    if (e.type === 'score' && s) {
      const def = (sport.scoring_events || {})[e.payload.event_type] || {};
      if (model === 'event') t[s].score += def.points || 0;
      else if (model === 'innings') { t[s].score += def.runs || 0; if (def.legal_ball) t[s].balls++; if (def.wicket) t[s].wickets++; }
      else if (model === 'round') t[s].score += def.rounds || 0;
    } else if (e.type === 'discipline' && s) t[s].fair_play += e.payload.points;
    else if (e.type === 'tiebreak_winner' && s) tiebreak = e.payload.team_id;
  }
  const h = t.home.score, a = t.away.score;
  let winner = h > a ? m.home_team_id : a > h ? m.away_team_id : tiebreak;
  let outcome = 'pending';
  if (status === 'completed') {
    if (winner) outcome = winner === m.home_team_id ? 'home_win' : 'away_win';
    else outcome = sport.draw_allowed ? 'draw' : 'undecided';
  }
  if (h === a && !tiebreak) winner = null;
  const bpo = per.balls_per_over || 6;
  const side = (x) => ({ team_id: x.team_id, score: x.score,
    wickets: model === 'innings' ? x.wickets : null, balls: model === 'innings' ? x.balls : null,
    overs: model === 'innings' ? `${Math.floor(x.balls / bpo)}.${x.balls % bpo}` : null, fair_play: x.fair_play });
  return { status, outcome, winner_team_id: winner, tiebreak_winner_team_id: tiebreak, home: side(t.home), away: side(t.away),
    compensatedBy, model, raw: t, sport };
}

function scoreView(m) {
  const p = project(m);
  return {
    match_id: m.match_id, sport_id: m.sport_id, league_id: m.league_id || null, status: p.status, outcome: p.outcome,
    winner_team_id: p.winner_team_id, tiebreak_winner_team_id: p.tiebreak_winner_team_id, home: p.home, away: p.away,
    version: m.events.length,
    events: m.events.map((e) => ({ sequence: e.sequence, event_id: e.event_id, type: e.type, payload: e.payload, signature: e.signature,
      compensated: p.compensatedBy.has(e.event_id), compensated_by: p.compensatedBy.get(e.event_id) || null, recorded_at: e.recorded_at })),
  };
}

// Finds an existing event by id across all streams (event ids are globally unique).
function findEvent(eventId) {
  const ref = S.eventIndex && S.eventIndex.get(eventId);
  if (!ref) return null;
  const m = S.matches.get(ref);
  return m ? m.events.find((e) => e.event_id === eventId) : null;
}
function indexEvent(eventId, matchId) { if (!S.eventIndex) S.eventIndex = new Map(); S.eventIndex.set(eventId, matchId); }
function rebuildIndex() { S.eventIndex = new Map(); for (const m of S.matches.values()) for (const e of m.events) S.eventIndex.set(e.event_id, m.match_id); }

const fingerprint = (b) => canonical({ event_id: b.event_id, match_id: b.match_id, type: b.type, payload: b.payload === undefined ? {} : b.payload });

// Returns {status, body} — throws ApiError on rejection. Never mutates on rejection.
function appendEvent(b) {
  const f = validateEvent(b);
  if (f.length) throw vErr(f);
  const payload = b.payload === undefined ? {} : b.payload;
  if (!S.eventIndex) rebuildIndex();
  const existing = findEvent(b.event_id);
  if (existing) {
    if (existing._fp === fingerprint(b)) return { status: 200, body: existing._response, duplicate: true };
    throw err(409, 'DUPLICATE_EVENT_ID', `Event ${b.event_id} already exists with a different body.`, { event_id: b.event_id });
  }
  let m = S.matches.get(b.match_id);
  if (b.type === 'match_init') {
    if (!S.sports.has(payload.sport_id)) throw err(404, 'SPORT_NOT_FOUND', `Sport ${payload.sport_id} not found.`, { sport_id: payload.sport_id });
    if (m) throw err(409, 'MATCH_EXISTS', `Match ${b.match_id} already exists.`, { match_id: b.match_id });
    m = newStream(b.match_id, payload.sport_id, payload.home_team_id, payload.away_team_id, payload.league_id);
  } else {
    if (!m) throw err(404, 'MATCH_NOT_FOUND', `Match ${b.match_id} not found.`, { match_id: b.match_id });
    const p = project(m);
    const sport = p.sport;
    const teamSide = (team) => (team === m.home_team_id ? 'home' : team === m.away_team_id ? 'away' : null);
    if (['score', 'discipline', 'tiebreak_winner'].includes(b.type) && !teamSide(payload.team_id)) throw vErr(['payload.team_id'], 'team_id must be the home or away team');
    if (b.type === 'score' && !Object.prototype.hasOwnProperty.call(sport.scoring_events || {}, payload.event_type)) {
      throw err(400, 'UNKNOWN_EVENT_TYPE', `Event type ${payload.event_type} is not defined for ${m.sport_id}.`, { event_type: payload.event_type });
    }
    switch (b.type) {
      case 'match_start':
        if (p.status !== 'upcoming') throw err(409, 'ILLEGAL_TRANSITION', `Cannot start a match that is ${p.status}.`, { match_id: m.match_id, status: p.status });
        break;
      case 'match_end':
        if (p.status !== 'in_progress') throw err(409, 'ILLEGAL_TRANSITION', `Cannot end a match that is ${p.status}.`, { match_id: m.match_id, status: p.status });
        if (p.home.score === p.away.score && !sport.draw_allowed && !p.tiebreak_winner_team_id) throw err(409, 'TIE_NOT_ALLOWED', 'Score is level and draws are not allowed.', { match_id: m.match_id });
        break;
      case 'score': case 'discipline': case 'tiebreak_winner':
        if (p.status !== 'in_progress') throw err(409, 'MATCH_NOT_IN_PROGRESS', `Match ${m.match_id} is ${p.status}.`, { match_id: m.match_id, status: p.status });
        if (b.type === 'score') {
          const side = teamSide(payload.team_id);
          if (p.model === 'innings') {
            const per = sport.periods;
            if (p.raw[side].balls >= per.innings_per_team * per.overs_per_innings * per.balls_per_over || p.raw[side].wickets >= per.innings_per_team * per.wickets_per_innings) {
              throw err(409, 'INNINGS_COMPLETE', `Innings of ${payload.team_id} is complete.`, { match_id: m.match_id, team_id: payload.team_id });
            }
          } else if (p.model === 'round') {
            const need = (sport.periods.best_of + 1) / 2;
            if (p.raw.home.score >= need || p.raw.away.score >= need) throw err(409, 'SERIES_ALREADY_DECIDED', 'The series is already decided.', { match_id: m.match_id });
          }
        }
        break;
      case 'compensation': {
        const target = findEvent(payload.compensates);
        if (!target) throw err(404, 'EVENT_NOT_FOUND', `Event ${payload.compensates} not found.`, { event_id: payload.compensates });
        const inMatch = m.events.includes(target);
        if (!inMatch || !COMPENSABLE.includes(target.type) || p.compensatedBy.has(target.event_id)) {
          throw err(409, 'INVALID_COMPENSATION', `Event ${payload.compensates} cannot be compensated.`, { event_id: payload.compensates });
        }
        break;
      }
      default:
    }
  }
  const sequence = m.events.length + 1;
  const signature = sign(b.event_id, payload);
  const response = { event_id: b.event_id, match_id: b.match_id, type: b.type, sequence, match_version: sequence, signature };
  const ev = { sequence, event_id: b.event_id, type: b.type, payload: clone(payload), signature, recorded_at: nowIso(), _fp: fingerprint(b), _response: response };
  m.events.push(ev);
  indexEvent(b.event_id, m.match_id);
  put('matches', m.match_id, m);
  db.appendEvent({ match_id: m.match_id, ...ev });
  try { require('../queue').publish('match.event', { match_id: m.match_id, event_id: b.event_id, type: b.type, sequence }); } catch (e) { /* ignore */ }
  return { status: 201, body: response };
}

function getScore(matchId) {
  const m = S.matches.get(matchId);
  if (!m) throw err(404, 'MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId });
  return scoreView(m);
}

module.exports = { appendEvent, getScore, project, scoreView, newStream, rebuildIndex, validateEvent, fingerprint, findEvent };
