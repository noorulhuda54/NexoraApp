'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
after(stop);
const setup = {
  league: { league_id: 'lg-r1', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-09-01', close: '2026-09-30' }, max_squad_size: 3, required_positions: { gk: 1 } },
  squads: [{ squad_id: 'sq-a', club_id: 'club-a', tenant_id: 'tenant-alpha', name: 'A' }, { squad_id: 'sq-b', club_id: 'club-b', tenant_id: 'tenant-alpha', name: 'B' },
    { squad_id: 'sq-x', club_id: 'club-x', tenant_id: 'tenant-beta', name: 'X' }],
  players: [{ player_id: 'p1', name: 'Ali', position: 'gk', squad_id: 'sq-a', role: 'captain' }, { player_id: 'p2', name: 'Bilal', position: 'df', squad_id: 'sq-a', role: 'starter' },
    { player_id: 'p3', name: 'C', position: 'df', squad_id: 'sq-b', role: 'starter' }, { player_id: 'p4', name: 'D', position: 'df', squad_id: 'sq-b', role: 'starter' },
    { player_id: 'p5', name: 'E', position: 'df', squad_id: 'sq-b', role: 'starter' }],
  matches_in_progress: [],
};
beforeEach(async () => { await post('/audit/v1/reset', {}); });
const tr = (o) => ({ request_id: 'tr-' + Math.random().toString(36).slice(2, 9), league_id: 'lg-r1', player_id: 'p2', type: 'transfer', from_squad_id: 'sq-a', to_squad_id: 'sq-b',
  effective_date: '2026-09-30', loan_end_date: null, reason: 'Tactical move', requested_by: 'user-77', ...o });

test('setup + transfer accepted + idempotent', async () => {
  const s = await post('/audit/v1/roster/setup', { ...setup, players: setup.players.slice(0, 3) });
  assert.strictEqual(s.status, 201); assert.deepStrictEqual(s.body, { league_id: 'lg-r1', status: 'configured', squad_counts: { 'sq-a': 2, 'sq-b': 1, 'sq-x': 0 } });
  const body = tr({ request_id: 'tr-001' });
  const r = await post('/audit/v1/roster/transfer', body);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.state, 'active'); assert.strictEqual(r.body.blocking_match_id, null);
  assert.deepStrictEqual(r.body.registration, { player_id: 'p2', league_id: 'lg-r1', squad_id: 'sq-b', parent_squad_id: null, registration_type: 'transfer', start_date: '2026-09-30', loan_end_date: null, role: 'substitute' });
  assert.strictEqual(r.body.audit_entry.action, 'transfer'); assert.strictEqual(r.body.audit_entry.who, 'user-77'); assert.strictEqual(r.body.audit_entry.why, 'Tactical move');
  const again = await post('/audit/v1/roster/transfer', body);
  assert.strictEqual(again.status, 200); assert.deepStrictEqual(again.body, r.body);
  const h = (await get('/audit/v1/roster/history/p2')).body;
  assert.strictEqual(h.current_squad_id, 'sq-b'); assert.strictEqual(h.history.length, 1);
});
test('rule checks in exact order', async () => {
  await post('/audit/v1/roster/setup', setup);
  const code = async (o) => (await post('/audit/v1/roster/transfer', tr(o))).body.error.code;
  assert.strictEqual(await code({ type: 'loan', loan_end_date: '2026-09-01' }), 'VALIDATION_ERROR');
  assert.strictEqual(await code({ to_squad_id: null }), 'VALIDATION_ERROR');
  assert.strictEqual(await code({ league_id: 'nope' }), 'LEAGUE_NOT_FOUND');
  assert.strictEqual(await code({ player_id: 'nope' }), 'PLAYER_NOT_FOUND');
  assert.strictEqual(await code({ to_squad_id: 'nope' }), 'SQUAD_NOT_FOUND');
  assert.strictEqual(await code({ to_squad_id: 'sq-x' }), 'CROSS_TENANT_TRANSFER');
  assert.strictEqual(await code({ from_squad_id: 'sq-b' }), 'NOT_IN_SQUAD');
  assert.strictEqual(await code({ effective_date: '2026-10-01' }), 'TRANSFER_WINDOW_CLOSED');
  assert.strictEqual(await code({}), 'SQUAD_FULL');
  assert.strictEqual(await code({ player_id: 'p1', type: 'release', to_squad_id: null }), 'MIN_POSITION_VIOLATION');
  const rel = await post('/audit/v1/roster/transfer', tr({ type: 'release', to_squad_id: null, effective_date: '2026-12-01' }));
  assert.strictEqual(rel.status, 201); assert.strictEqual(rel.body.registration, null);
  assert.strictEqual((await get('/audit/v1/roster/history/p2')).body.current_squad_id, null);
});
test('loan with automatic return, PLAYER_ON_LOAN', async () => {
  await post('/audit/v1/roster/setup', { ...setup, players: setup.players.slice(0, 3) });
  const r = await post('/audit/v1/roster/transfer', tr({ type: 'loan', effective_date: '2026-09-10', loan_end_date: '2026-12-31' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.registration.registration_type, 'loan'); assert.strictEqual(r.body.registration.parent_squad_id, 'sq-a');
  assert.strictEqual((await post('/audit/v1/roster/transfer', tr({ from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2026-09-20' }))).body.error.code, 'PLAYER_ON_LOAN');
  let h = (await get('/audit/v1/roster/history/p2?as_of=2026-12-31')).body;
  assert.strictEqual(h.current_squad_id, 'sq-b'); assert.strictEqual(h.history.length, 1);
  h = (await get('/audit/v1/roster/history/p2?as_of=2027-01-05')).body;
  assert.strictEqual(h.current_squad_id, 'sq-a'); assert.strictEqual(h.as_of, '2027-01-05');
  assert.deepStrictEqual(h.history.map((e) => e.action), ['loan', 'loan_return']);
  assert.strictEqual(h.history[1].who, 'system');
  h = (await get('/audit/v1/roster/history/p2?as_of=2027-01-06')).body;
  assert.strictEqual(h.history.length, 2);
  assert.strictEqual((await get('/audit/v1/roster/history/nobody')).status, 404);
});
test('deferred transfer on last window day during in-progress match', async () => {
  await post('/audit/v1/roster/setup', { ...setup, players: setup.players.slice(0, 3), matches_in_progress: [{ match_id: 'm-live', home_squad_id: 'sq-a', away_squad_id: 'sq-b' }] });
  const r = await post('/audit/v1/roster/transfer', tr({ effective_date: '2026-09-30' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.state, 'deferred_until_match_end'); assert.strictEqual(r.body.blocking_match_id, 'm-live');
  assert.strictEqual(r.body.audit_entry.state, 'deferred_until_match_end');
});
