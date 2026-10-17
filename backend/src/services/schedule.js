'use strict';
// FR-1.3 — manual rescheduling with real-time conflict detection and the administrative match state machine.
const { err, vErr, isId } = require('../lib');
const { S, put } = require('../state');
const { project } = require('./matches');

const MATCH_MINUTES = 120;      // slot length used for venue / team overlap
const MIN_REST_HOURS = 48;      // minimum rest between two matches of the same team
// Admin transitions on top of the event-derived status (upcoming / in_progress / completed).
const TRANSITIONS = { upcoming: ['postponed', 'cancelled'], in_progress: ['abandoned'], postponed: ['upcoming', 'cancelled'], abandoned: ['upcoming', 'cancelled'], completed: [], cancelled: [] };

const statusOf = (m) => m.admin_status || project(m).status;
const venueOf = (m) => m.venue_id || (S.clubs.get(m.home_team_id) || {}).home_venue?.venue_id || null;
const squadPlayers = (team) => {
  const out = new Set();
  for (const r of S.registry.values()) for (const st of Object.values(r.leagues)) if (st.registration && st.registration.squad_id === team) out.add(r.player_id);
  return out;
};

function conflictsFor(m, at, venueId) {
  const start = Date.parse(at), end = start + MATCH_MINUTES * 60000;
  const conflicts = [];
  const venue = S.venues.get(venueId);
  if (venue && Array.isArray(venue.availability) && venue.availability.length) {
    const ok = venue.availability.some((w) => Date.parse(w.from) <= start && end <= Date.parse(w.to));
    if (!ok) conflicts.push({ type: 'venue_unavailable', venue_id: venueId });
  }
  const mine = [m.home_team_id, m.away_team_id];
  const myPlayers = new Set([...squadPlayers(m.home_team_id), ...squadPlayers(m.away_team_id)]);
  for (const o of S.matches.values()) {
    if (o.match_id === m.match_id || !o.scheduled_at || ['cancelled', 'postponed'].includes(statusOf(o))) continue;
    const os = Date.parse(o.scheduled_at), oe = os + MATCH_MINUTES * 60000;
    const overlap = start < oe && os < end;
    if (overlap && venueOf(o) && venueOf(o) === venueId) conflicts.push({ type: 'venue_double_booking', venue_id: venueId, match_id: o.match_id });
    for (const t of mine) {
      if (o.home_team_id !== t && o.away_team_id !== t) continue;
      if (overlap) conflicts.push({ type: 'team_overlap', team_id: t, match_id: o.match_id });
      else if (Math.abs(os - start) < MIN_REST_HOURS * 3600000) conflicts.push({ type: 'min_rest_violation', team_id: t, match_id: o.match_id, min_rest_hours: MIN_REST_HOURS });
    }
    if (overlap) {
      const theirs = new Set([...squadPlayers(o.home_team_id), ...squadPlayers(o.away_team_id)]);
      for (const p of myPlayers) if (theirs.has(p) && !mine.includes(o.home_team_id) && !mine.includes(o.away_team_id)) conflicts.push({ type: 'player_overlap', player_id: p, match_id: o.match_id });
    }
  }
  return conflicts;
}

function reschedule(matchId, b) {
  const f = [];
  if (typeof b.scheduled_at !== 'string' || isNaN(Date.parse(b.scheduled_at))) f.push('scheduled_at');
  if (b.venue_id !== undefined && b.venue_id !== null && !isId(b.venue_id)) f.push('venue_id');
  if (f.length) throw vErr(f);
  const m = S.matches.get(matchId);
  if (!m) throw err(404, 'MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId });
  const st = statusOf(m);
  if (!['upcoming', 'postponed'].includes(st)) throw err(409, 'ILLEGAL_TRANSITION', `A ${st} match cannot be rescheduled.`, { match_id: matchId, status: st });
  const venueId = b.venue_id || venueOf(m);
  const conflicts = conflictsFor(m, b.scheduled_at, venueId);
  if (conflicts.length) throw err(409, 'SCHEDULE_CONFLICT', 'The new slot conflicts with other fixtures.', { match_id: matchId, conflicts });
  m.scheduled_at = new Date(Date.parse(b.scheduled_at)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  m.venue_id = venueId;
  if (m.admin_status === 'postponed') delete m.admin_status;
  put('matches', m.match_id, m);
  require('../queue').publish('match.rescheduled', { match_id: m.match_id, scheduled_at: m.scheduled_at, venue_id: venueId });
  return { match_id: m.match_id, scheduled_at: m.scheduled_at, venue_id: venueId, status: statusOf(m) };
}

function setStatus(matchId, b) {
  const to = b.status;
  if (!['upcoming', 'postponed', 'abandoned', 'cancelled'].includes(to)) throw vErr(['status']);
  const m = S.matches.get(matchId);
  if (!m) throw err(404, 'MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId });
  const from = statusOf(m);
  if (!(TRANSITIONS[from] || []).includes(to)) throw err(409, 'ILLEGAL_TRANSITION', `Cannot move a match from ${from} to ${to}.`, { match_id: matchId, from, to });
  if (to === 'upcoming') delete m.admin_status; else m.admin_status = to;
  put('matches', m.match_id, m);
  require('../queue').publish('match.status', { match_id: m.match_id, from, to });
  // postponing frees the slot: re-run conflict detection for the other fixtures of both teams
  const affected = to === 'postponed' ? [...S.matches.values()].filter((o) => o.match_id !== m.match_id && o.scheduled_at
    && [m.home_team_id, m.away_team_id].some((t) => o.home_team_id === t || o.away_team_id === t))
    .map((o) => ({ match_id: o.match_id, conflicts: conflictsFor(o, o.scheduled_at, venueOf(o)) })) : [];
  return { match_id: m.match_id, from, status: to, rechecked: affected };
}

module.exports = { reschedule, setStatus, conflictsFor, statusOf };
