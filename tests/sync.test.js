'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
const { sign } = require('../backend/src/lib');
after(stop);
beforeEach(async () => {
  await post('/audit/v1/reset', {});
  await post('/audit/v1/leagues', { league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2'], fixtures: [{ match_id: 'm1', home: 't1', away: 't2' }], qualification: { spots: 1 } });
  await post('/audit/v1/events', { event_id: 'e1', match_id: 'm1', type: 'match_start', payload: {} });
  await post('/audit/v1/roster/setup', { league: { league_id: 'lg-r1', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-09-01', close: '2026-09-30' }, max_squad_size: 1, required_positions: {} },
    squads: [{ squad_id: 'sq-a', club_id: 'c', tenant_id: 'tenant-alpha' }, { squad_id: 'sq-b', club_id: 'd', tenant_id: 'tenant-alpha' }],
    players: [{ player_id: 'p1', position: 'df', squad_id: 'sq-a', role: 'starter' }, { player_id: 'p2', position: 'df', squad_id: 'sq-a', role: 'starter' }] });
});
const transfer = (id, pid) => ({ request_id: id, league_id: 'lg-r1', player_id: pid, type: 'transfer', from_squad_id: 'sq-a', to_squad_id: 'sq-b', effective_date: '2026-09-15', reason: 'x', requested_by: 'u' });

test('per-action results, ordering, conflicts and duplicate replay', async () => {
  const req = { device_id: 'dev-1', actions: [
    { action_id: 'a2', type: 'roster_transfer', queued_at: '2026-10-17T11:01:00Z', base_version: 0, payload: transfer('tr-1', 'p1') },
    { action_id: 'a1', type: 'score_event', queued_at: '2026-10-17T11:00:00Z', base_version: 0, payload: { event_id: 'evt-9', match_id: 'm1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'a3', type: 'roster_transfer', queued_at: '2026-10-17T11:02:00Z', base_version: 0, payload: transfer('tr-2', 'p2') },
    { action_id: 'a4', type: 'score_event', queued_at: '2026-10-17T11:03:00Z', base_version: 2, payload: { event_id: 'evt-10', match_id: 'm1', type: 'score', payload: { team_id: 't2', event_type: 'goal' } } },
    { action_id: 'a5', type: 'score_event', queued_at: '2026-10-17T11:04:00Z', base_version: 9, payload: { event_id: 'evt-11', match_id: 'm1', type: 'score', payload: { team_id: 't2', event_type: 'goal' } } },
    { action_id: 'a6', type: 'score_event', queued_at: '2026-10-17T11:05:00Z', base_version: 0, payload: { event_id: 'evt-12', match_id: 'nope', type: 'score', payload: { team_id: 't2', event_type: 'goal' } } },
  ] };
  const r = await post('/audit/v1/offline-sync', req);
  assert.strictEqual(r.status, 200);
  const [a2, a1, a3, a4, a5, a6] = r.body.results;
  assert.deepStrictEqual(a1, { action_id: 'a1', status: 'applied', resolution: 'rebased_append', error_code: null, processed_order: 1, server_version: 2, signature: sign('evt-9', { team_id: 't1', event_type: 'goal' }, 'demo-salt') });
  assert.deepStrictEqual([a2.status, a2.resolution, a2.processed_order, a2.server_version, a2.signature], ['applied', 'appended', 2, 1, null]);
  assert.deepStrictEqual([a3.status, a3.resolution, a3.error_code, a3.server_version], ['rejected', 'server_wins', 'SQUAD_FULL', 0]);
  assert.deepStrictEqual([a4.status, a4.resolution, a4.server_version], ['applied', 'appended', 3]);
  assert.deepStrictEqual([a5.status, a5.error_code], ['rejected', 'INVALID_BASE_VERSION']);
  assert.deepStrictEqual([a6.status, a6.error_code], ['rejected', 'MATCH_NOT_FOUND']);
  assert.deepStrictEqual(r.body.summary, { applied: 3, rejected: 3, duplicate: 0 });
  const again = await post('/audit/v1/offline-sync', req);
  assert.ok(again.body.results.every((x) => x.status === 'duplicate' && x.resolution === 'skipped_duplicate'));
  assert.deepStrictEqual(again.body.summary, { applied: 0, rejected: 0, duplicate: 6 });
  assert.strictEqual((await get('/audit/v1/score/m1')).body.version, 3);
  // same event id with identical payload from another device → duplicate; different → DUPLICATE_EVENT_ID
  const other = await post('/audit/v1/offline-sync', { device_id: 'dev-2', actions: [
    { action_id: 'b1', type: 'score_event', queued_at: '2026-10-17T12:00:00Z', base_version: 3, payload: { event_id: 'evt-9', match_id: 'm1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'b2', type: 'score_event', queued_at: '2026-10-17T12:00:01Z', base_version: 3, payload: { event_id: 'evt-9', match_id: 'm1', type: 'score', payload: { team_id: 't2', event_type: 'goal' } } }] });
  assert.deepStrictEqual(other.body.results.map((x) => x.status + ':' + x.error_code), ['duplicate:null', 'rejected:DUPLICATE_EVENT_ID']);
  assert.strictEqual((await post('/audit/v1/offline-sync', { device_id: 'd', actions: [] })).status, 400);
});
