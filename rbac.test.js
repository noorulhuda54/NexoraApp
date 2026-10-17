'use strict';
const { test, after, before } = require('node:test');
const assert = require('node:assert');
const { call, post, get, stop } = require('./helpers');
after(stop);
let M;
before(async () => { await post('/audit/v1/reset', {}); M = (await post('/audit/v1/rbac-matrix')).body; });
const A = 200, D = 403;
const roles = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
test('probe matrix (Section 5.13)', async () => {
  const c = M.context;
  const rows = [
    ['POST', '/audit/v1/rbac/tenants', [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${c.own_league_id}/fixtures`, [A, A, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${c.other_league_id}/fixtures`, [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${c.foreign_league_id}/fixtures`, [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/clubs/${c.own_club_id}/roster`, [A, D, A, D, D]],
    ['POST', `/audit/v1/rbac/clubs/${c.own_club_id}/products`, [A, D, A, D, D]],
    ['POST', `/audit/v1/rbac/clubs/${c.other_club_id}/roster`, [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/clubs/${c.foreign_club_id}/products`, [A, D, D, D, D]],
    ['PATCH', `/audit/v1/rbac/players/${c.own_player_id}`, [A, D, A, A, D]],
    ['PATCH', `/audit/v1/rbac/players/${c.other_player_id}`, [A, D, D, D, D]],
    ['PATCH', `/audit/v1/rbac/players/${c.foreign_player_id}`, [A, D, D, D, D]],
    ['GET', `/audit/v1/rbac/clubs/${c.own_club_id}`, [A, A, A, A, A]],
    ['GET', `/audit/v1/rbac/clubs/${c.other_club_id}`, [A, A, A, A, A]],
    ['GET', `/audit/v1/rbac/clubs/${c.foreign_club_id}`, [A, D, D, D, D]],
    ['GET', '/audit/v1/rbac/platform/config', [A, D, D, D, D]],
  ];
  for (const [m, p, exp] of rows) {
    for (let i = 0; i < 5; i++) {
      const r = await call(m, p, m === 'GET' ? undefined : {}, { authorization: 'Bearer ' + M.tokens[roles[i]] });
      assert.strictEqual(r.status, exp[i], `${roles[i]} ${m} ${p}`);
      if (exp[i] === 200) assert.deepStrictEqual(r.body, { authorized: true }); else assert.strictEqual(r.body.error.code, 'FORBIDDEN');
    }
  }
});
test('invalid tokens → 401', async () => {
  const p = '/audit/v1/rbac/platform/config';
  assert.strictEqual((await get(p)).body.error.code, 'UNAUTHENTICATED');
  const t = M.tokens.super_admin;
  const tampered = t.slice(0, -3) + (t.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.strictEqual((await get(p, { authorization: 'Bearer ' + tampered })).status, 401);
  const [, payload] = t.split('.');
  const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + payload + '.';
  assert.strictEqual((await get(p, { authorization: 'Bearer ' + none })).status, 401);
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  const { jwtSign } = require('../backend/src/lib');
  void claims; void jwtSign;
  const expired = (() => { const crypto = require('crypto'); const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const pl = Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString('base64url'); return `${h}.${pl}.${crypto.createHmac('sha256', 'x').update(h + '.' + pl).digest('base64url')}`; })();
  assert.strictEqual((await get(p, { authorization: 'Bearer ' + expired })).status, 401);
  assert.strictEqual((await get('/audit/v1/rbac/clubs/nope', { authorization: 'Bearer ' + t })).status, 404);
});
test('rate limit on /api/v1/ping only', async () => {
  require('../backend/src/routes/api').resetRateLimit();
  const rs = await Promise.all([...Array(150)].map(() => get('/api/v1/ping')));
  assert.deepStrictEqual(rs[0].body, { pong: true });
  const limited = rs.filter((r) => r.status === 429);
  assert.ok(limited.length >= 40);
  assert.strictEqual(limited[0].body.error.code, 'RATE_LIMITED'); assert.ok(limited[0].headers.get('retry-after'));
  const audits = await Promise.all([...Array(150)].map(() => get('/health')));
  assert.ok(audits.every((r) => r.status === 200));
  require('../backend/src/routes/api').resetRateLimit();
});
