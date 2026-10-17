'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
after(stop);
beforeEach(() => post('/audit/v1/reset', {}));
let n = 0;
const ev = (match_id, type, payload) => post('/audit/v1/events', { event_id: 's' + (++n), match_id, type, payload });
async function play(mid, goals, sport = 'goal') {
  await ev(mid, 'match_start', {});
  for (const [team, k] of goals) for (let i = 0; i < k; i++) await ev(mid, 'score', { team_id: team, event_type: sport });
  await ev(mid, 'match_end', {});
}

test('league validation and errors', async () => {
  const base = { league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2'], fixtures: [{ match_id: 'm1', home: 't1', away: 't2' }], qualification: { spots: 1 } };
  assert.deepStrictEqual((await post('/audit/v1/leagues', base)).body, { league_id: 'lg-1', status: 'created', team_count: 2, fixture_count: 1 });
  assert.strictEqual((await post('/audit/v1/leagues', base)).body.error.code, 'LEAGUE_EXISTS');
  assert.strictEqual((await post('/audit/v1/leagues', { ...base, league_id: 'lg-2' })).body.error.code, 'MATCH_EXISTS');
  assert.strictEqual((await post('/audit/v1/leagues', { ...base, league_id: 'lg-3', sport_id: 'nope', fixtures: [] })).body.error.code, 'SPORT_NOT_FOUND');
  assert.strictEqual((await post('/audit/v1/leagues', { ...base, league_id: 'lg-4', fixtures: [{ match_id: 'q', home: 't1', away: 't9' }] })).status, 400);
  assert.strictEqual((await post('/audit/v1/leagues', { ...base, league_id: 'lg-5', qualification: { spots: 3 } })).status, 400);
  assert.strictEqual((await get('/audit/v1/standings/nope')).body.error.code, 'LEAGUE_NOT_FOUND');
  assert.strictEqual((await get('/audit/v1/score/m1')).body.status, 'upcoming');
});

test('three-way tie resolved by head-to-head mini-league, restart on split', async () => {
  // t1,t2,t3 each beat one another in a cycle; t4 loses all. Then goal margins differ.
  const fx = [['m12', 't1', 't2'], ['m23', 't2', 't3'], ['m31', 't3', 't1'], ['m14', 't1', 't4'], ['m24', 't2', 't4'], ['m34', 't3', 't4']];
  await post('/audit/v1/leagues', { league_id: 'lg', sport_id: 'football', teams: ['t1', 't2', 't3', 't4'], fixtures: fx.map(([match_id, home, away]) => ({ match_id, home, away })), qualification: { spots: 2 }, lots_seed: 42 });
  await play('m12', [['t1', 3]]); await play('m23', [['t2', 1]]); await play('m31', [['t3', 1]]);
  await play('m14', [['t1', 1]]); await play('m24', [['t2', 5]]); await play('m34', [['t3', 1]]);
  const s = (await get('/audit/v1/standings/lg')).body;
  // h2h points all 3; h2h diff: t1 +3-1=+2, t2 -3+1=-2, t3 0 → t1, t3, t2
  assert.deepStrictEqual(s.table.map((r) => r.team_id), ['t1', 't3', 't2', 't4']);
  assert.deepStrictEqual(s.table.map((r) => r.resolved_by), ['h2h_diff', 'h2h_diff', null, null]);
  assert.strictEqual(s.table[0].points, 6); assert.strictEqual(s.table[3].status, 'eliminated');
  assert.deepStrictEqual(s.h2h.t1.t2, { played: 1, points: 3, scored: 3, conceded: 0 });
  assert.strictEqual(s.table[0].status, 'still_possible'); // two others can reach 6 points (spec formula)
});

test('compensation after qualification recomputes standings', async () => {
  await post('/audit/v1/leagues', { league_id: 'lc', sport_id: 'football', teams: ['a', 'b', 'c'], fixtures: [{ match_id: 'c1', home: 'a', away: 'b' }, { match_id: 'c2', home: 'b', away: 'c' }], qualification: { spots: 1 } });
  await ev('c1', 'match_start', {});
  await post('/audit/v1/events', { event_id: 'goal-a', match_id: 'c1', type: 'score', payload: { team_id: 'a', event_type: 'goal' } });
  await ev('c1', 'match_end', {});
  let s = (await get('/audit/v1/standings/lc')).body;
  assert.strictEqual(s.table[0].team_id, 'a'); assert.strictEqual(s.table[0].points, 3);
  await post('/audit/v1/events', { event_id: 'undo', match_id: 'c1', type: 'compensation', payload: { compensates: 'goal-a', reason: 'VAR' } });
  s = (await get('/audit/v1/standings/lc')).body;
  const a = s.table.find((r) => r.team_id === 'a');
  assert.strictEqual(a.points, 1); assert.strictEqual(a.drawn, 1);
  assert.strictEqual(s.h2h.a.b.points, 1);
});

test('draw_lots ordering matches Appendix A vector 2', async () => {
  await post('/audit/v1/leagues', { league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2', 't3'], fixtures: [], qualification: { spots: 1 }, lots_seed: 42 });
  const s = (await get('/audit/v1/standings/lg-1')).body;
  assert.deepStrictEqual(s.table.map((r) => r.team_id), ['t1', 't3', 't2']);
  assert.deepStrictEqual(s.table.map((r) => r.resolved_by), ['draw_lots', 'draw_lots', null]);
});

test('innings net run rate and esports round diff', async () => {
  await post('/audit/v1/leagues', { league_id: 'cr', sport_id: 'cricket', teams: ['x', 'y'], fixtures: [{ match_id: 'cm', home: 'x', away: 'y' }], qualification: { spots: 1 } });
  await ev('cm', 'match_start', {});
  for (let i = 0; i < 6; i++) await ev('cm', 'score', { team_id: 'x', event_type: 'four' }); // 24 off 1 over
  for (let i = 0; i < 12; i++) await ev('cm', 'score', { team_id: 'y', event_type: 'single' }); // 12 off 2 overs
  await ev('cm', 'match_end', {});
  const s = (await get('/audit/v1/standings/cr')).body;
  const x = s.table.find((r) => r.team_id === 'x');
  assert.strictEqual(x.diff, 18); // 24/1 - 12/2
  assert.strictEqual(s.table.find((r) => r.team_id === 'y').diff, -18);
});
