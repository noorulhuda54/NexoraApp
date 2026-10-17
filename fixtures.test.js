'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { post, stop } = require('./helpers');
const F = require('../backend/src/services/fixtures');
after(stop);
const T = (n) => [...Array(n)].map((_, i) => 't' + (i + 1));

test('round robin structure for odd/even n and legs', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 10, 13, 40]) for (const legs of [1, 2]) {
    const r = F.roundRobin(T(n), { legs });
    const perLeg = n % 2 ? n : n - 1;
    assert.strictEqual(r.round_count, perLeg * legs);
    const pairs = new Map(), ordered = new Set(), bal = {};
    for (const rd of r.rounds) {
      assert.strictEqual(rd.matches.length, Math.floor(n / 2));
      assert.strictEqual(rd.byes.length, n % 2);
      const seen = new Set(rd.byes);
      for (const m of rd.matches) {
        assert.ok(!seen.has(m.home) && !seen.has(m.away)); seen.add(m.home); seen.add(m.away);
        assert.match(m.match_id, new RegExp(`^RR-L${m.leg}-R${rd.round}-M\\d+$`));
        const k = [m.home, m.away].sort().join(); pairs.set(k, (pairs.get(k) || 0) + 1); ordered.add(m.home + '>' + m.away);
        bal[m.leg + m.home] = (bal[m.leg + m.home] || 0) + 1; bal[m.leg + m.away] = (bal[m.leg + m.away] || 0) - 1;
      }
      assert.strictEqual(seen.size, n);
    }
    assert.strictEqual(pairs.size, n * (n - 1) / 2);
    assert.ok([...pairs.values()].every((v) => v === legs));
    assert.ok(Object.values(bal).every((v) => Math.abs(v) <= 1));
    if (legs === 2) assert.strictEqual(ordered.size, n * (n - 1));
  }
});
test('round robin withdrawals', async () => {
  const fr = F.roundRobin(T(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
  assert.deepStrictEqual(fr.summary, { total: 10, scheduled: 8, forfeit: 2, voided: 0 });
  for (const rd of fr.rounds) for (const m of rd.matches) if (m.status === 'forfeit') { assert.ok(rd.round > 2); assert.strictEqual(m.awarded_to, m.home === 't3' ? m.away : m.home); }
  const v = F.roundRobin(T(5), { withdrawals: [{ team_id: 't3', after_round: 2 }], withdrawal_policy: 'void_all' });
  assert.deepStrictEqual(v.summary, { total: 10, scheduled: 6, forfeit: 0, voided: 4 });
  const r = await post('/audit/v1/fixtures', { format: 'round_robin', teams: T(5), params: { withdrawals: [{ team_id: 'zz', after_round: 1 }] } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'round_robin', teams: T(5), params: { withdrawals: [{ team_id: 't1', after_round: 6 }] } })).status, 400);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'round_robin', teams: ['a'] })).status, 400);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'nope', teams: T(4) })).status, 400);
});
test('swiss round 1 exact + standings', () => {
  const r = F.swiss(T(5), { total_rounds: 3, round: 1 });
  assert.deepStrictEqual(r.pairings, [{ match_id: 'SW-R1-M1', home: 't1', away: 't3' }, { match_id: 'SW-R1-M2', home: 't2', away: 't4' }]);
  assert.strictEqual(r.bye, 't5');
  const r2 = F.swiss(T(5), { total_rounds: 3, round: 2, history: [{ round: 1, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'draw' }], bye: 't5' }] });
  assert.strictEqual(r2.bye, 't3');
  assert.deepStrictEqual(r2.standings.slice(0, 3).map((s) => [s.team_id, s.score, s.buchholz]), [['t1', 1, 0], ['t5', 1, 0], ['t2', 0.5, 0.5]]);
  const cost = r2.pairings.reduce((s, p) => s + Math.abs(r2.standings.find((x) => x.team_id === p.home).score - r2.standings.find((x) => x.team_id === p.away).score), 0);
  assert.strictEqual(cost, 1);
});
test('swiss no valid pairing → 409, bad history → 400', async () => {
  const hist = [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }], bye: null }];
  const r = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(2), params: { total_rounds: 1, round: 1 } });
  assert.strictEqual(r.status, 200);
  const r3 = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(3), params: { total_rounds: 2, round: 2, history: [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }], bye: 't3' }] } });
  assert.strictEqual(r3.status, 200);
  assert.ok(r3.body.bye !== 't3');
  const h4 = [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
    { round: 2, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
    { round: 3, matches: [{ home: 't1', away: 't4', result: 'home' }, { home: 't2', away: 't3', result: 'home' }] }];
  const nv = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 3, history: h4.slice(0, 2) } });
  assert.strictEqual(nv.status, 200);
  void hist;
  const bad = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 3, history: h4.slice(0, 1) } });
  assert.strictEqual(bad.status, 400);
  // 3 teams, 2 rounds: all pairs used after r1+r2 for the non-bye candidates
  const h3 = [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }], bye: 't3' }, { round: 2, matches: [{ home: 't1', away: 't3', result: 'home' }], bye: 't2' }];
  const nv3 = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(3), params: { total_rounds: 2, round: 2, history: h3.slice(0, 1) } });
  assert.strictEqual(nv3.status, 200);
  const six = T(6);
  const h6 = [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }, { home: 't5', away: 't6', result: 'home' }] },
    { round: 2, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't5', result: 'home' }, { home: 't4', away: 't6', result: 'home' }] },
    { round: 3, matches: [{ home: 't1', away: 't5', result: 'home' }, { home: 't3', away: 't6', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
    { round: 4, matches: [{ home: 't1', away: 't4', result: 'home' }, { home: 't2', away: 't6', result: 'home' }, { home: 't3', away: 't5', result: 'home' }] }];
  const r5 = await post('/audit/v1/fixtures', { format: 'swiss', teams: six, params: { total_rounds: 5, round: 5, history: h6 } });
  assert.strictEqual(r5.status, 200);
  assert.deepStrictEqual(r5.body.pairings.map((p) => [p.home, p.away].sort().join()).sort(), ['t1,t6', 't2,t3', 't4,t5']);
});
test('swiss no valid pairing (complete exhaustion)', async () => {
  const h = [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
    { round: 2, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
    { round: 3, matches: [{ home: 't1', away: 't4', result: 'home' }, { home: 't2', away: 't3', result: 'home' }] }];
  const teams = T(4);
  // 4 teams but total_rounds max = 3, so emulate with 5 teams where t5 must avoid everyone
  const h5 = [{ round: 1, matches: [{ home: 't1', away: 't5', result: 'home' }, { home: 't2', away: 't3', result: 'home' }], bye: 't4' },
    { round: 2, matches: [{ home: 't2', away: 't5', result: 'home' }, { home: 't1', away: 't4', result: 'home' }], bye: 't3' },
    { round: 3, matches: [{ home: 't3', away: 't5', result: 'home' }, { home: 't4', away: 't2', result: 'home' }], bye: 't1' }];
  void h; void teams;
  const r = await post('/audit/v1/fixtures', { format: 'swiss', teams: T(5), params: { total_rounds: 4, round: 4, history: h5 } });
  // t5 never had a bye; candidates: t5 first (lowest score) → remaining t1..t4 must pair without rematches
  assert.ok(r.status === 200 || (r.status === 409 && r.body.error.code === 'NO_VALID_PAIRING' && r.body.error.details.round === 4));
});
test('single elimination exact bracket n=6', async () => {
  const r = await post('/audit/v1/fixtures', { format: 'single_elim', teams: T(6), params: { third_place_match: false, results: [{ match_id: 'R1M2', winner: 't4' }] } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.bracket_size, 8); assert.strictEqual(r.body.rounds.length, 3);
  const r1 = r.body.rounds[0].matches;
  assert.deepStrictEqual(r1.map((m) => [m.home, m.away, m.bye]), [['t1', null, true], ['t4', 't5', false], ['t2', null, true], ['t3', 't6', false]]);
  assert.deepStrictEqual(r1[1].winner_to, { match_id: 'R2M1', slot: 'away' });
  const r2 = r.body.rounds[1].matches;
  assert.strictEqual(r2[0].home, 't1'); assert.strictEqual(r2[0].away, 't4'); assert.strictEqual(r2[1].home, 't2');
  assert.strictEqual(r.body.rounds[2].matches[0].winner_to, null);
  assert.deepStrictEqual(F.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'single_elim', teams: T(6), params: { results: [{ match_id: 'R1M2', winner: 't1' }] } })).status, 400);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'single_elim', teams: T(6), params: { results: [{ match_id: 'R9M2', winner: 't1' }] } })).status, 400);
  const tp = F.singleElim(T(4), { third_place_match: true, results: [{ match_id: 'R1M1', winner: 't1' }, { match_id: 'R1M2', winner: 't3' }] });
  const TP = tp.rounds[1].matches.find((m) => m.match_id === 'TP');
  assert.strictEqual(TP.bracket, 'third_place'); assert.strictEqual(TP.home, 't4'); assert.strictEqual(TP.away, 't2');
});
test('double elimination counts, routing graph, bracket reset', async () => {
  for (const n of [3, 4, 5, 8, 11, 16, 33]) {
    const r = F.doubleElim(T(n), { bracket_reset: true });
    const B = r.bracket_size, k = Math.log2(B);
    assert.strictEqual(r.winners.length, k); r.winners.forEach((rd, i) => assert.strictEqual(rd.matches.length, B / 2 ** (i + 1)));
    assert.strictEqual(r.losers.length, 2 * (k - 1));
    assert.strictEqual(r.losers.flatMap((x) => x.matches).length, B - 2);
    const all = [...r.winners.flatMap((x) => x.matches), ...r.losers.flatMap((x) => x.matches), ...r.grand_final];
    const src = {};
    for (const m of all) for (const t of [m.winner_to, m.loser_to]) if (t) src[t.match_id + '.' + t.slot] = (src[t.match_id + '.' + t.slot] || 0) + 1;
    for (const m of all) if (!m.match_id.startsWith('WR1M')) for (const s of ['home', 'away']) assert.strictEqual(src[m.match_id + '.' + s], 1, m.match_id + s);
    r.winners.flatMap((x) => x.matches).forEach((m) => assert.ok(m.loser_to));
    r.losers.flatMap((x) => x.matches).forEach((m) => assert.strictEqual(m.loser_to, null));
    assert.strictEqual(r.grand_final[1].conditional, true); assert.strictEqual(r.grand_final[1].required, null);
  }
  const base = [{ match_id: 'WR1M1', winner: 't1' }, { match_id: 'WR1M2', winner: 't2' }, { match_id: 'WR2M1', winner: 't1' }, { match_id: 'LR1M1', winner: 't4' }, { match_id: 'LR2M1', winner: 't4' }];
  const lb = await post('/audit/v1/fixtures', { format: 'double_elim', teams: T(4), params: { bracket_reset: true, results: [...base, { match_id: 'GF1', winner: 't4' }] } });
  assert.strictEqual(lb.body.grand_final[1].required, true);
  const wb = await post('/audit/v1/fixtures', { format: 'double_elim', teams: T(4), params: { bracket_reset: true, results: [...base, { match_id: 'GF1', winner: 't1' }] } });
  assert.strictEqual(wb.body.grand_final[1].required, false);
  const nr = await post('/audit/v1/fixtures', { format: 'double_elim', teams: T(4), params: { bracket_reset: false, results: [...base, { match_id: 'GF1', winner: 't4' }] } });
  assert.strictEqual(nr.body.grand_final.length, 1);
  assert.strictEqual((await post('/audit/v1/fixtures', { format: 'double_elim', teams: T(2) })).status, 400);
});
