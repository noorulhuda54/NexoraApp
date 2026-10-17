'use strict';
const { test, after, before } = require('node:test');
const assert = require('node:assert');
const { post, stop } = require('./helpers');
after(stop);
before(() => post('/audit/v1/reset', {}));
const kabaddi = { sport_id: 'kabaddi', name: 'Kabaddi', scoring_model: 'event', periods: { count: 2, duration_minutes: 20 },
  scoring_events: { raid_point: { points: 1 }, tackle_point: { points: 1 }, all_out: { points: 2 } }, draw_allowed: false,
  overtime: { policy: 'golden_score', duration_minutes: 5 }, roster: { min_squad_size: 7, max_squad_size: 12, required_positions: { raider: 2 } } };
test('create mystery sport, duplicate → 409', async () => {
  const r = await post('/audit/v1/sports', kabaddi);
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.status, 'created');
  assert.deepStrictEqual(r.body.config.tie_break_order, ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots']);
  assert.strictEqual((await post('/audit/v1/sports', kabaddi)).body.error.code, 'SPORT_EXISTS');
  assert.strictEqual((await post('/audit/v1/sports', { ...kabaddi, sport_id: 'football' })).status, 409);
});
test('validation of sport fields', async () => {
  const r = await post('/audit/v1/sports', { ...kabaddi, sport_id: "x'; DROP TABLE sports;--" });
  assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.body.error.details.fields, ['sport_id']);
  const r2 = await post('/audit/v1/sports', { ...kabaddi, sport_id: 'rr', scoring_model: 'round', periods: { best_of: 4 }, scoring_events: { map_win: { rounds: 1 } } });
  assert.deepStrictEqual(r2.body.error.details.fields, ['periods']);
  const r3 = await post('/audit/v1/sports', { ...kabaddi, sport_id: 'inn', scoring_model: 'innings', periods: { innings_per_team: 1, overs_per_innings: 10, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: { super_six: { runs: 6, legal_ball: true, wicket: false } } });
  assert.strictEqual(r3.status, 201);
  const r4 = await post('/audit/v1/sports', { ...kabaddi, sport_id: 'tb', tie_break_order: ['scored', 'scored'] });
  assert.deepStrictEqual(r4.body.error.details.fields, ['tie_break_order']);
});
