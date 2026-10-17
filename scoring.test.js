'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
const { sign } = require('../backend/src/lib');
after(stop);
beforeEach(() => post('/audit/v1/reset', {}));
let n = 0;
const ev = (match_id, type, payload) => post('/audit/v1/events', { event_id: 'e' + (++n), match_id, type, payload });
const init = (id, sport, h = 'h', a = 'a') => ev(id, 'match_init', { sport_id: sport, home_team_id: h, away_team_id: a });

test('event model: signatures, sequence, idempotency, compensation', async () => {
  const r = await post('/audit/v1/events', { event_id: 'evt-1', match_id: 'x1', type: 'match_init', payload: { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' } });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.sequence, 1); assert.strictEqual(r.body.match_version, 1);
  assert.strictEqual(r.body.signature, sign('evt-1', { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' }, 'demo-salt'));
  assert.strictEqual((await ev('x1', 'score', { team_id: 't1', event_type: 'goal' })).body.error.code, 'MATCH_NOT_IN_PROGRESS');
  await ev('x1', 'match_start', {});
  assert.strictEqual((await ev('x1', 'match_start', {})).body.error.code, 'ILLEGAL_TRANSITION');
  const g = await post('/audit/v1/events', { event_id: 'g1', match_id: 'x1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } });
  assert.strictEqual(g.status, 201);
  const replay = await post('/audit/v1/events', { event_id: 'g1', match_id: 'x1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } });
  assert.strictEqual(replay.status, 200); assert.deepStrictEqual(replay.body, g.body);
  assert.strictEqual((await post('/audit/v1/events', { event_id: 'g1', match_id: 'x1', type: 'score', payload: { team_id: 't2', event_type: 'goal' } })).body.error.code, 'DUPLICATE_EVENT_ID');
  assert.strictEqual((await ev('x1', 'score', { team_id: 'zz', event_type: 'goal' })).status, 400);
  assert.strictEqual((await ev('x1', 'score', { team_id: 't1', event_type: 'touchdown' })).body.error.code, 'UNKNOWN_EVENT_TYPE');
  await ev('x1', 'discipline', { team_id: 't2', points: -1 });
  await ev('x1', 'match_end', {});
  let s = (await get('/audit/v1/score/x1')).body;
  assert.strictEqual(s.outcome, 'home_win'); assert.strictEqual(s.winner_team_id, 't1'); assert.strictEqual(s.away.fair_play, -1);
  const c = await post('/audit/v1/events', { event_id: 'c1', match_id: 'x1', type: 'compensation', payload: { compensates: 'g1', reason: 'offside' } });
  assert.strictEqual(c.status, 201);
  s = (await get('/audit/v1/score/x1')).body;
  assert.strictEqual(s.outcome, 'draw'); assert.strictEqual(s.home.score, 0);
  const gEv = s.events.find((e) => e.event_id === 'g1');
  assert.strictEqual(gEv.compensated, true); assert.strictEqual(gEv.compensated_by, 'c1');
  assert.deepStrictEqual(gEv.payload, { team_id: 't1', event_type: 'goal' });
  assert.strictEqual((await ev('x1', 'compensation', { compensates: 'g1' })).body.error.code, 'INVALID_COMPENSATION');
  assert.strictEqual((await ev('x1', 'compensation', { compensates: 'evt-1' })).body.error.code, 'INVALID_COMPENSATION');
  assert.strictEqual((await ev('x1', 'compensation', { compensates: 'nope' })).body.error.code, 'EVENT_NOT_FOUND');
  assert.strictEqual((await ev('nope', 'match_start', {})).body.error.code, 'MATCH_NOT_FOUND');
  assert.strictEqual((await init('x1', 'football')).body.error.code, 'MATCH_EXISTS');
  assert.strictEqual((await init('x2', 'nosport')).body.error.code, 'SPORT_NOT_FOUND');
  assert.strictEqual((await get('/audit/v1/score/nope')).status, 404);
});
test('no-draw sport: TIE_NOT_ALLOWED, tiebreak winner, undecided after compensation', async () => {
  await init('b1', 'basketball'); await ev('b1', 'match_start', {});
  await ev('b1', 'score', { team_id: 'h', event_type: 'three_pointer' }); await ev('b1', 'score', { team_id: 'a', event_type: 'three_pointer' });
  assert.strictEqual((await ev('b1', 'match_end', {})).body.error.code, 'TIE_NOT_ALLOWED');
  await post('/audit/v1/events', { event_id: 'tb1', match_id: 'b1', type: 'tiebreak_winner', payload: { team_id: 'a' } });
  assert.strictEqual((await ev('b1', 'match_end', {})).status, 201);
  let s = (await get('/audit/v1/score/b1')).body;
  assert.strictEqual(s.outcome, 'away_win'); assert.strictEqual(s.winner_team_id, 'a'); assert.strictEqual(s.tiebreak_winner_team_id, 'a');
  await ev('b1', 'compensation', { compensates: 'tb1' });
  s = (await get('/audit/v1/score/b1')).body;
  assert.strictEqual(s.outcome, 'undecided'); assert.strictEqual(s.winner_team_id, null); assert.strictEqual(s.status, 'completed');
});
test('innings model: runs, wickets, overs, INNINGS_COMPLETE', async () => {
  await post('/audit/v1/sports', { sport_id: 'mini_cricket', name: 'Mini', scoring_model: 'innings', periods: { innings_per_team: 1, overs_per_innings: 1, balls_per_over: 6, wickets_per_innings: 2 },
    scoring_events: { hit: { runs: 6, legal_ball: true, wicket: false }, extra: { runs: 1, legal_ball: false, wicket: false }, out: { runs: 0, legal_ball: true, wicket: true } },
    draw_allowed: true, overtime: { policy: 'none' }, roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} } });
  await init('c1', 'mini_cricket'); await ev('c1', 'match_start', {});
  for (const t of ['hit', 'extra', 'hit', 'out', 'hit']) assert.strictEqual((await ev('c1', 'score', { team_id: 'h', event_type: t })).status, 201);
  let s = (await get('/audit/v1/score/c1')).body;
  assert.deepStrictEqual([s.home.score, s.home.wickets, s.home.balls, s.home.overs], [19, 1, 4, '0.4']);
  await ev('c1', 'score', { team_id: 'h', event_type: 'out' });
  assert.strictEqual((await ev('c1', 'score', { team_id: 'h', event_type: 'hit' })).body.error.code, 'INNINGS_COMPLETE');
  assert.strictEqual(s.away.wickets, 0); assert.strictEqual(s.away.overs, '0.0');
  const f = (await get('/audit/v1/score/c1')).body;
  assert.strictEqual(f.home.overs, '0.5');
  // cricket base sport scoring
  await init('c2', 'cricket'); await ev('c2', 'match_start', {});
  await ev('c2', 'score', { team_id: 'a', event_type: 'wide' }); await ev('c2', 'score', { team_id: 'a', event_type: 'four' });
  s = (await get('/audit/v1/score/c2')).body;
  assert.deepStrictEqual([s.away.score, s.away.balls], [5, 1]);
});
test('round model: SERIES_ALREADY_DECIDED; mystery event sport works without restart', async () => {
  await init('r1', 'esports'); await ev('r1', 'match_start', {});
  await ev('r1', 'score', { team_id: 'h', event_type: 'round_win' }); await ev('r1', 'score', { team_id: 'h', event_type: 'round_win' });
  assert.strictEqual((await ev('r1', 'score', { team_id: 'a', event_type: 'round_win' })).body.error.code, 'SERIES_ALREADY_DECIDED');
  await ev('r1', 'match_end', {});
  assert.strictEqual((await get('/audit/v1/score/r1')).body.outcome, 'home_win');
  await post('/audit/v1/sports', { sport_id: 'kabaddi', name: 'Kabaddi', scoring_model: 'event', periods: { count: 2, duration_minutes: 20 },
    scoring_events: { raid_point: { points: 1 }, all_out: { points: 2 } }, draw_allowed: false, overtime: { policy: 'golden_score' }, roster: { min_squad_size: 7, max_squad_size: 12, required_positions: {} } });
  await init('k1', 'kabaddi'); await ev('k1', 'match_start', {});
  await ev('k1', 'score', { team_id: 'a', event_type: 'all_out' });
  assert.strictEqual((await get('/audit/v1/score/k1')).body.away.score, 2);
});
