'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { post, get, stop } = require('./helpers');
const { sign, lotsKey, canonical } = require('../backend/src/lib');
after(stop);

test('Appendix A vector 1: signature', () => {
  assert.strictEqual(canonical({ team_id: 't1', event_type: 'goal' }), '{"event_type":"goal","team_id":"t1"}');
  assert.strictEqual(sign('evt-1', { team_id: 't1', event_type: 'goal' }, 'demo-salt'), '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501');
});
test('Appendix A vector 2: drawing of lots', () => {
  assert.strictEqual(lotsKey(42, 'lg-1', 't1'), '0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
  assert.strictEqual(lotsKey(42, 'lg-1', 't3'), 'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
});
test('canonical JSON nesting, unicode, numbers', () => {
  assert.strictEqual(canonical({ b: [1, { z: true, a: null }], a: 'é' }), '{"a":"é","b":[1,{"a":null,"z":true}]}');
});
test('health and reset', async () => {
  assert.deepStrictEqual((await get('/health')).body, { status: 'ok' });
  const r = await post('/audit/v1/reset', { seed: 7, stock: { 'var-jersey-001-M': 3 } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { status: 'reset_complete', seed: 7, sports: ['football', 'basketball', 'cricket', 'esports'], tenants: ['tenant-alpha', 'tenant-beta'], stock: { 'var-jersey-001-M': 3, 'var-jersey-001-L': 5 } });
  const r2 = await post('/audit/v1/reset', {});
  assert.strictEqual(r2.body.seed, 42);
  assert.strictEqual((await post('/audit/v1/reset', { seed: 'x' })).status, 400);
});
test('malformed JSON → 400, >1MB → 413', async () => {
  const r = await post('/audit/v1/sports', '{bad');
  assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error.code, 'VALIDATION_ERROR');
  const big = await post('/audit/v1/sports', JSON.stringify({ x: 'a'.repeat(1100000) }));
  assert.strictEqual(big.status, 413); assert.strictEqual(big.body.error.code, 'PAYLOAD_TOO_LARGE');
});
