'use strict';
const { test, after, before } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
after(stop);
before(() => post('/audit/v1/reset', {}));
const login = async (email) => (await post('/api/v1/auth/login', { email, password: 'Nascon@26' })).body.token;
const H = (t) => ({ authorization: 'Bearer ' + t });

test('login for all five demo accounts; bad password rejected', async () => {
  for (const e of ['admin', 'organizer', 'manager', 'player', 'viewer']) {
    const r = await post('/api/v1/auth/login', { email: `${e}@nascon.test`, password: 'Nascon@26' });
    assert.strictEqual(r.status, 200); assert.ok(r.body.token);
  }
  assert.strictEqual((await post('/api/v1/auth/login', { email: 'admin@nascon.test', password: 'x' })).status, 401);
  assert.strictEqual((await get('/api/v1/matches')).status, 401);
});
test('viewer reads fixtures/standings/clubs; cannot score or move players', async () => {
  const v = await login('viewer@nascon.test');
  const ms = (await get('/api/v1/matches', H(v))).body.matches;
  assert.strictEqual(ms.length, 6);
  const live = ms.find((m) => m.status === 'in_progress');
  const d = (await get('/api/v1/matches/' + live.match_id, H(v))).body;
  assert.strictEqual(d.can_score, false); assert.strictEqual(d.pinned_product.product_id, 'prod-jersey-001');
  assert.strictEqual((await get('/api/v1/standings/league-alpha-1', H(v))).body.table.length, 4);
  assert.strictEqual((await get('/api/v1/clubs/club-alpha-1', H(v))).body.roster.length, 4);
  assert.strictEqual((await get('/api/v1/clubs/club-beta-1', H(v))).status, 403);
  assert.strictEqual((await post('/api/v1/events', { event_id: 'v1', match_id: live.match_id, type: 'score', payload: { team_id: live.home.team_id, event_type: 'goal' } }, H(v))).status, 403);
  const s = await post('/api/v1/sync', { device_id: 'phone-v', actions: [{ action_id: 'x1', type: 'score_event', queued_at: '2026-10-17T10:00:00Z', base_version: 0, payload: { event_id: 'v2', match_id: live.match_id, type: 'score', payload: { team_id: live.home.team_id, event_type: 'goal' } } }] }, H(v));
  assert.strictEqual(s.body.results[0].error_code, 'FORBIDDEN');
});
test('organizer scores via sync, manager transfers via sync, checkout via app', async () => {
  const o = await login('organizer@nascon.test');
  const m = await login('manager@nascon.test');
  const live = (await get('/api/v1/matches', H(o))).body.matches.find((x) => x.status === 'in_progress');
  const r = await post('/api/v1/sync', { device_id: 'phone-o', actions: [{ action_id: 'o1', type: 'score_event', queued_at: '2026-10-17T10:00:00Z', base_version: live.version, payload: { event_id: 'o-ev-1', match_id: live.match_id, type: 'score', payload: { team_id: live.home.team_id, event_type: 'goal' } } }] }, H(o));
  assert.strictEqual(r.body.results[0].status, 'applied'); assert.strictEqual(r.body.results[0].resolution, 'appended');
  const t = await post('/api/v1/sync', { device_id: 'phone-m', actions: [{ action_id: 'm1', type: 'roster_transfer', queued_at: '2026-10-17T10:00:00Z', base_version: 0,
    payload: { request_id: 'tr-app-1', league_id: 'league-alpha-1', player_id: 'player-alpha-5', type: 'loan', from_squad_id: 'club-alpha-1', to_squad_id: 'club-alpha-2', effective_date: '2026-10-17', loan_end_date: '2026-11-30', reason: 'Game time', requested_by: 'mobile' } }] }, H(m));
  assert.strictEqual(t.body.results[0].status, 'applied');
  const notMine = await post('/api/v1/roster/transfer', { request_id: 'tr-app-2', league_id: 'league-alpha-1', player_id: 'player-alpha-6', type: 'release', from_squad_id: 'club-alpha-2', effective_date: '2026-10-17' }, H(m));
  assert.strictEqual(notMine.status, 403);
  const p = await login('player@nascon.test');
  const c = await post('/api/v1/checkout', { order_id: 'app-ord-1', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], discount_code: 'WELCOME10', payment: { token: 'tok_success' } }, H(p));
  assert.strictEqual(c.status, 201); assert.strictEqual(c.body.total_minor, 405000);
  assert.strictEqual((await get('/api/v1/orders', H(p))).body.orders.length, 1);
  const pdf = await get('/api/v1/orders/app-ord-1/receipt.pdf', H(p));
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual((await get('/api/v1/orders/app-ord-1/receipt.pdf', H(o))).status, 403);
  assert.strictEqual((await get('/api/v1/products', H(p))).body.products[0].variants.length, 2);
});

test('rescheduling conflicts, admin status machine, order fulfilment', async () => {
  await post('/audit/v1/reset', {});
  const o = await login('organizer@nascon.test');
  const ms = (await get('/api/v1/matches', H(o))).body.matches;
  const up = ms.filter((m) => m.status === 'upcoming');
  const other = ms.find((m) => m.match_id !== up[0].match_id && (m.home.team_id === up[0].home.team_id || m.away.team_id === up[0].home.team_id));
  const clash = await post(`/api/v1/matches/${up[0].match_id}/reschedule`, { scheduled_at: other.scheduled_at }, H(o));
  assert.strictEqual(clash.status, 409); assert.strictEqual(clash.body.error.code, 'SCHEDULE_CONFLICT');
  assert.ok(clash.body.error.details.conflicts.some((c) => c.type === 'team_overlap' && c.match_id === other.match_id));
  const ok = await post(`/api/v1/matches/${up[0].match_id}/reschedule`, { scheduled_at: '2027-03-01T15:00:00Z' }, H(o));
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await post(`/api/v1/matches/${up[0].match_id}/status`, { status: 'postponed' }, H(o))).body.status, 'postponed');
  assert.strictEqual((await post(`/api/v1/matches/${up[0].match_id}/status`, { status: 'abandoned' }, H(o))).body.error.code, 'ILLEGAL_TRANSITION');
  const done = ms.find((m) => m.status === 'completed');
  assert.strictEqual((await post(`/api/v1/matches/${done.match_id}/status`, { status: 'cancelled' }, H(o))).status, 409);
  const v = await login('viewer@nascon.test');
  assert.strictEqual((await post(`/api/v1/matches/${up[1].match_id}/status`, { status: 'postponed' }, H(v))).status, 403);
  const p = await login('player@nascon.test');
  await post('/api/v1/checkout', { order_id: 'ff-1', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], payment: { token: 'tok_success' } }, H(p));
  const mgr = await login('manager@nascon.test');
  assert.strictEqual((await post('/api/v1/orders/ff-1/status', { status: 'packed' }, H(mgr))).body.status, 'packed');
  assert.strictEqual((await post('/api/v1/orders/ff-1/status', { status: 'delivered' }, H(mgr))).status, 409);
  assert.strictEqual((await post('/api/v1/orders/ff-1/status', { status: 'refunded' }, H(mgr))).body.status, 'refunded');
  assert.strictEqual((await get('/audit/v1/inventory/var-jersey-001-L')).body.stock, 5);
  assert.strictEqual((await post('/api/v1/orders/ff-1/status', { status: 'packed' }, H(p))).status, 403);
});
