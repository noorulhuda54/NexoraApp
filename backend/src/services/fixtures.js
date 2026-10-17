'use strict';
// Section 5.7 — pure fixture/bracket computation (custom implementations, no libraries).
const { err, vErr, isId, isObj, isInt } = require('../lib');

const LIMITS = { round_robin: [2, 40], swiss: [2, 64], single_elim: [2, 128], double_elim: [3, 128] };

function generate(body) {
  const f = [];
  const { format, teams } = body;
  const params = body.params === undefined || body.params === null ? {} : body.params;
  if (!LIMITS[format]) f.push('format');
  if (!Array.isArray(teams) || teams.some((t) => !isId(t)) || new Set(teams).size !== teams.length
      || (LIMITS[format] && (teams.length < LIMITS[format][0] || teams.length > LIMITS[format][1]))) f.push('teams');
  if (!isObj(params)) f.push('params');
  if (f.length) throw vErr(f);
  if (format === 'round_robin') return roundRobin(teams, params);
  if (format === 'swiss') return swiss(teams, params);
  if (format === 'single_elim') return singleElim(teams, params);
  return doubleElim(teams, params);
}

// ---------- A) round robin (circle method) ----------
function roundRobin(teams, params) {
  const legs = params.legs === undefined || params.legs === null ? 1 : params.legs;
  const policy = params.withdrawal_policy === undefined || params.withdrawal_policy === null ? 'forfeit_remaining' : params.withdrawal_policy;
  const withdrawals = params.withdrawals === undefined || params.withdrawals === null ? [] : params.withdrawals;
  const f = [];
  if (legs !== 1 && legs !== 2) f.push('legs');
  if (!['void_all', 'forfeit_remaining'].includes(policy)) f.push('withdrawal_policy');
  if (!Array.isArray(withdrawals)) f.push('withdrawals');
  if (f.length) throw vErr(f);
  const n = teams.length;
  const perLeg = n % 2 === 0 ? n - 1 : n;
  const roundCount = perLeg * legs;
  const wd = new Map();
  for (const w of withdrawals) {
    if (!isObj(w) || !teams.includes(w.team_id) || !isInt(w.after_round) || w.after_round < 0 || w.after_round > roundCount) throw vErr(['withdrawals']);
    wd.set(w.team_id, w.after_round);
  }
  // odd n: the phantom (bye) slot is the fixed circle position so every real pair alternates evenly
  const arr = n % 2 === 1 ? [null, ...teams] : teams.slice();
  const N = arr.length;
  const base = [];
  let rot = arr.slice();
  for (let r = 0; r < N - 1; r++) {
    const pairs = [];
    let bye = null;
    for (let i = 0; i < N / 2; i++) {
      const a = rot[i], b = rot[N - 1 - i];
      if (a === null || b === null) { bye = a === null ? b : a; continue; }
      // Berger-style alternation keeps |home - away| <= 1 for every team within a leg.
      let home, away;
      if (i === 0) { if (r % 2 === 0) { home = a; away = b; } else { home = b; away = a; } }
      else if (i % 2 === 1) { home = b; away = a; } else { home = a; away = b; }
      pairs.push([home, away]);
    }
    base.push({ pairs, bye });
    rot = [rot[0], rot[N - 1], ...rot.slice(1, N - 1)];
  }
  const rounds = [];
  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };
  for (let leg = 1; leg <= legs; leg++) {
    base.forEach((b, ri) => {
      const round = (leg - 1) * perLeg + ri + 1;
      const matches = b.pairs.map(([h, a], mi) => {
        const [home, away] = leg === 1 ? [h, a] : [a, h];
        const m = { match_id: `RR-L${leg}-R${round}-M${mi + 1}`, leg, home, away, status: 'scheduled', awarded_to: null };
        const hw = wd.has(home), aw = wd.has(away);
        if (hw || aw) {
          if (policy === 'void_all') m.status = 'voided';
          else {
            const hOut = hw && round > wd.get(home), aOut = aw && round > wd.get(away);
            if (hOut && aOut) m.status = 'voided';
            else if (hOut) { m.status = 'forfeit'; m.awarded_to = away; } else if (aOut) { m.status = 'forfeit'; m.awarded_to = home; }
          }
        }
        summary.total++; summary[m.status === 'scheduled' ? 'scheduled' : m.status === 'forfeit' ? 'forfeit' : 'voided']++;
        return m;
      });
      rounds.push({ round, matches, byes: b.bye === null ? [] : [b.bye] });
    });
  }
  return { format: 'round_robin', legs, team_count: n, round_count: roundCount, rounds, summary };
}

// ---------- B) swiss ----------
function swiss(teams, params) {
  const n = teams.length;
  const f = [];
  const total = params.total_rounds === undefined || params.total_rounds === null ? Math.ceil(Math.log2(n)) : params.total_rounds;
  const round = params.round === undefined || params.round === null ? 1 : params.round;
  const history = params.history === undefined || params.history === null ? [] : params.history;
  if (!isInt(total) || total < 1 || total > n - 1) f.push('total_rounds');
  if (!isInt(round) || round < 1 || (isInt(total) && round > total)) f.push('round');
  if (!Array.isArray(history)) f.push('history');
  if (f.length) throw vErr(f);
  const idx = new Map(teams.map((t, i) => [t, i]));
  const score = new Map(teams.map((t) => [t, 0]));
  const opps = new Map(teams.map((t) => [t, []]));
  const hadBye = new Set();
  const met = new Set();
  const key = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
  if (history.length !== round - 1) throw vErr(['history']);
  const seen = new Set();
  for (const h of history) {
    if (!isObj(h) || !isInt(h.round) || h.round < 1 || h.round > round - 1 || seen.has(h.round) || !Array.isArray(h.matches)) throw vErr(['history']);
    seen.add(h.round);
    for (const m of h.matches) {
      if (!isObj(m) || !idx.has(m.home) || !idx.has(m.away) || m.home === m.away || !['home', 'away', 'draw'].includes(m.result)) throw vErr(['history']);
      opps.get(m.home).push(m.away); opps.get(m.away).push(m.home); met.add(key(m.home, m.away));
      if (m.result === 'home') score.set(m.home, score.get(m.home) + 1);
      else if (m.result === 'away') score.set(m.away, score.get(m.away) + 1);
      else { score.set(m.home, score.get(m.home) + 0.5); score.set(m.away, score.get(m.away) + 0.5); }
    }
    if (h.bye !== undefined && h.bye !== null) {
      if (!idx.has(h.bye)) throw vErr(['history']);
      hadBye.add(h.bye); score.set(h.bye, score.get(h.bye) + 1);
    }
  }
  const buch = new Map(teams.map((t) => [t, opps.get(t).reduce((s, o) => s + score.get(o), 0)]));
  const ordered = teams.slice().sort((a, b) => score.get(b) - score.get(a) || buch.get(b) - buch.get(a) || idx.get(a) - idx.get(b));
  const standings = ordered.map((t, i) => ({ rank: i + 1, team_id: t, score: score.get(t), buchholz: buch.get(t) }));
  let pairs = null, bye = null;
  if (round === 1) {
    const m = Math.floor(n / 2);
    if (n % 2 === 1) bye = teams[n - 1];
    pairs = [];
    for (let i = 0; i < m; i++) pairs.push([teams[i], teams[i + m]]);
  } else {
    const candidates = n % 2 === 1
      ? teams.filter((t) => !hadBye.has(t)).sort((a, b) => score.get(a) - score.get(b) || idx.get(b) - idx.get(a))
      : [null];
    for (const c of candidates) {
      const pool = ordered.filter((t) => t !== c);
      const res = minCostPairing(pool, score, met, key);
      if (res) { pairs = res; bye = c; break; }
    }
    if (!pairs) throw err(409, 'NO_VALID_PAIRING', `No rematch-free pairing exists for round ${round}.`, { round });
    // higher-ranked team at home; order pairings by rank of their best team
    const rank = new Map(ordered.map((t, i) => [t, i]));
    pairs = pairs.map(([a, b]) => (rank.get(a) <= rank.get(b) ? [a, b] : [b, a])).sort((p, q) => rank.get(p[0]) - rank.get(q[0]));
  }
  return { format: 'swiss', round, total_rounds: total,
    pairings: pairs.map(([h, a], i) => ({ match_id: `SW-R${round}-M${i + 1}`, home: h, away: a })), bye, standings };
}

// Exact minimum of sum |score diff| over rematch-free perfect matchings.
// Branch & bound over teams in score order with two admissible lower bounds and a memo keyed by the used-set bitmask.
function minCostPairing(pool, score, met, key) {
  const n = pool.length;
  if (n === 0) return [];
  // pool is sorted by score descending
  const sc = pool.map((t) => score.get(t));
  const allowed = pool.map((a, i) => pool.map((b, j) => i !== j && !met.has(key(a, b))));
  if (allowed.some((row) => !row.some(Boolean))) return null;
  const cand = pool.map((_, i) => {
    const c = [];
    for (let j = 0; j < n; j++) if (allowed[i][j]) c.push(j);
    return c.sort((a, b) => Math.abs(sc[i] - sc[a]) - Math.abs(sc[i] - sc[b]) || a - b);
  });
  const used = new Uint8Array(n);
  const words = Math.ceil(n / 30);
  const mask = new Array(words).fill(0);
  const setBit = (i, on) => { const w = (i / 30) | 0, b = 1 << (i % 30); mask[w] = on ? mask[w] | b : mask[w] & ~b; };
  let best = Infinity, bestPairs = null, nodes = 0;
  const memo = new Map();
  const cur = [];
  function lowerBound() {
    // LB1: optimal unconstrained 1-D matching = pair consecutive scores
    let lb1 = 0, prev = -1;
    for (let i = 0; i < n; i++) if (!used[i]) { if (prev < 0) prev = i; else { lb1 += sc[prev] - sc[i]; prev = -1; } }
    // LB2: every team pays at least half of its cheapest still-available partner; Infinity when someone is stranded
    let lb2 = 0;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      let m = Infinity;
      for (const j of cand[i]) if (!used[j]) { m = Math.abs(sc[i] - sc[j]); break; }
      if (m === Infinity) return Infinity;
      lb2 += m / 2;
    }
    return Math.max(lb1, lb2);
  }
  function rec(cost) {
    if (++nodes > 2e6) return;
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) { if (cost < best) { best = cost; bestPairs = cur.slice(); } return; }
    if (cost + lowerBound() >= best) return;
    const k = mask.join(',');
    const prev = memo.get(k);
    if (prev !== undefined && prev <= cost) return;
    memo.set(k, cost);
    used[i] = 1; setBit(i, true);
    for (const j of cand[i]) {
      if (used[j]) continue;
      const c = cost + Math.abs(sc[i] - sc[j]);
      if (c >= best) break; // candidates are sorted by cost
      used[j] = 1; setBit(j, true); cur.push([pool[i], pool[j]]);
      rec(c);
      cur.pop(); used[j] = 0; setBit(j, false);
    }
    used[i] = 0; setBit(i, false);
  }
  rec(0);
  return bestPairs;
}

// ---------- C/D) elimination brackets ----------
function seedOrder(B) {
  let order = [1, 2];
  while (order.length < B) {
    const k2 = order.length * 2;
    order = order.flatMap((s) => [s, k2 + 1 - s]);
  }
  return order;
}
const MISSING = '__missing__';

function makeMatch(match_id, bracket, round, index) {
  return { match_id, bracket, round, index, home: undefined, away: undefined, home_seed: null, away_seed: null, bye: false,
    winner: null, loser: null, winner_to: null, loser_to: null };
}

// Propagate known participants/byes and apply results until fixpoint.
function runBracket(list, byId, seedOf, results, extraCheck) {
  const pending = new Map();
  for (const r of results) {
    if (!isObj(r) || typeof r.match_id !== 'string' || typeof r.winner !== 'string') throw vErr(['results']);
    if (!byId.has(r.match_id)) throw vErr(['results'], `Unknown match_id ${r.match_id}`);
    pending.set(r.match_id, r.winner);
  }
  const place = (target, team) => {
    if (!target) return;
    const m = byId.get(target.match_id);
    m[target.slot] = team;
    if (team !== MISSING && team !== undefined) m[target.slot + '_seed'] = seedOf(team);
  };
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of list) {
      if (m.winner !== null || m._done) continue;
      if (extraCheck && !extraCheck(m)) continue;
      if (m.home === undefined || m.away === undefined) continue;
      if (m.home === MISSING || m.away === MISSING) {
        const present = m.home === MISSING ? m.away : m.home;
        m.bye = true; m._done = true;
        m.winner = present === MISSING ? null : present; m.loser = null;
        if (pending.has(m.match_id)) {
          if (pending.get(m.match_id) !== m.winner) throw vErr(['results'], `Winner ${pending.get(m.match_id)} is not a participant of ${m.match_id}`);
          pending.delete(m.match_id);
        }
        place(m.winner_to, present); place(m.loser_to, MISSING);
        progress = true;
        continue;
      }
      if (pending.has(m.match_id)) {
        const w = pending.get(m.match_id);
        if (w !== m.home && w !== m.away) throw vErr(['results'], `Winner ${w} is not a participant of ${m.match_id}`);
        m.winner = w; m.loser = w === m.home ? m.away : m.home; m._done = true;
        pending.delete(m.match_id);
        place(m.winner_to, m.winner); place(m.loser_to, m.loser);
        progress = true;
      }
    }
  }
  if (pending.size) throw vErr(['results'], 'Result for a match whose participants are not determined');
}

function clean(m) {
  const o = { ...m };
  delete o._done;
  o.home = o.home === undefined || o.home === MISSING ? null : o.home;
  o.away = o.away === undefined || o.away === MISSING ? null : o.away;
  return o;
}

function buildWinners(teams, prefix, bracket) {
  const n = teams.length;
  let B = 1; while (B < n) B *= 2;
  if (B < 2) B = 2;
  const k = Math.log2(B);
  const order = seedOrder(B);
  const rounds = [];
  for (let r = 1; r <= k; r++) {
    const ms = [];
    for (let i = 1; i <= B / 2 ** r; i++) {
      const m = makeMatch(`${prefix}${r}M${i}`, bracket, r, i);
      if (r < k) m.winner_to = { match_id: `${prefix}${r + 1}M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
      ms.push(m);
    }
    rounds.push(ms);
  }
  rounds[0].forEach((m, i0) => {
    const s1 = order[2 * i0], s2 = order[2 * i0 + 1];
    const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
    m.home = teams[lo - 1]; m.home_seed = lo;
    if (hi > n) { m.away = MISSING; m.away_seed = null; } else { m.away = teams[hi - 1]; m.away_seed = hi; }
  });
  return { B, k, rounds };
}

function singleElim(teams, params) {
  const third = params.third_place_match === true;
  const results = params.results === undefined || params.results === null ? [] : params.results;
  if (params.third_place_match !== undefined && params.third_place_match !== null && typeof params.third_place_match !== 'boolean') throw vErr(['third_place_match']);
  if (!Array.isArray(results)) throw vErr(['results']);
  const { B, k, rounds } = buildWinners(teams, 'R', 'main');
  const list = rounds.flat();
  let tp = null;
  if (third && k >= 2) {
    tp = makeMatch('TP', 'third_place', k, 1);
    rounds[k - 2].forEach((m, i) => { m.loser_to = { match_id: 'TP', slot: i === 0 ? 'home' : 'away' }; });
    list.push(tp);
  }
  const byId = new Map(list.map((m) => [m.match_id, m]));
  const seedOf = (t) => teams.indexOf(t) + 1;
  runBracket(list, byId, seedOf, results);
  const outRounds = rounds.map((ms, i) => ({ round: i + 1, matches: ms.map(clean) }));
  if (tp) outRounds[k - 1].matches.push(clean(tp));
  return { format: 'single_elim', bracket_size: B, rounds: outRounds };
}

function doubleElim(teams, params) {
  const reset = params.bracket_reset === undefined || params.bracket_reset === null ? false : params.bracket_reset;
  if (typeof reset !== 'boolean') throw vErr(['bracket_reset']);
  const results = params.results === undefined || params.results === null ? [] : params.results;
  if (!Array.isArray(results)) throw vErr(['results']);
  const { B, k, rounds: wr } = buildWinners(teams, 'WR', 'winners');
  const lr = [];
  for (let j = 1; j <= k - 1; j++) {
    for (const r of [2 * j - 1, 2 * j]) {
      const ms = [];
      for (let i = 1; i <= B / 2 ** (j + 1); i++) ms.push(makeMatch(`LR${r}M${i}`, 'losers', r, i));
      lr.push(ms);
    }
  }
  const gf1 = makeMatch('GF1', 'grand_final', 1, 1);
  const gf2 = reset ? makeMatch('GF2', 'grand_final', 2, 1) : null;
  // winners-bracket loser routing
  wr[0].forEach((m, i0) => { m.loser_to = { match_id: `LR1M${Math.floor(i0 / 2) + 1}`, slot: i0 % 2 === 0 ? 'home' : 'away' }; });
  for (let r = 2; r <= k; r++) wr[r - 1].forEach((m, i0) => { m.loser_to = { match_id: `LR${2 * r - 2}M${i0 + 1}`, slot: 'away' }; });
  wr[k - 1][0].winner_to = { match_id: 'GF1', slot: 'home' };
  // losers-bracket winner routing
  for (let r = 1; r <= 2 * (k - 1); r++) {
    lr[r - 1].forEach((m, i0) => {
      const i = i0 + 1;
      if (r === 2 * (k - 1)) m.winner_to = { match_id: 'GF1', slot: 'away' };
      else if (r % 2 === 1) m.winner_to = { match_id: `LR${r + 1}M${i}`, slot: 'home' };
      else m.winner_to = { match_id: `LR${r + 1}M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
    });
  }
  if (gf2) { gf1.winner_to = { match_id: 'GF2', slot: 'away' }; gf1.loser_to = { match_id: 'GF2', slot: 'home' }; }
  const all = [...wr.flat(), ...lr.flat(), gf1, ...(gf2 ? [gf2] : [])];
  for (const m of all) { m.conditional = false; m.required = true; }
  if (gf2) { gf2.conditional = true; gf2.required = null; }
  const byId = new Map(all.map((m) => [m.match_id, m]));
  const seedOf = (t) => teams.indexOf(t) + 1;
  // GF2 may only be played when required (losers-bracket champion won GF1)
  const gfCheck = (m) => {
    if (m !== gf2) return true;
    if (!gf1._done) return false;
    if (gf1.winner !== gf1.away) { m._done = true; return false; }
    return true;
  };
  // GF2 participants mirror GF1 (filled via winner_to/loser_to), so only use them once GF1 is decided.
  const origPlace = gf1.winner_to;
  runBracket(all, byId, seedOf, results.filter((r) => !(isObj(r) && r.match_id === 'GF2')), gfCheck);
  if (gf2) {
    if (gf1._done) gf2.required = gf1.winner === gf1.away;
    if (!gf2.required) { gf2.home = gf1.home; gf2.away = gf1.away; gf2.home_seed = gf1.home_seed; gf2.away_seed = gf1.away_seed; }
    const r2 = results.filter((r) => isObj(r) && r.match_id === 'GF2');
    if (r2.length) {
      if (gf2.required !== true) throw vErr(['results'], 'GF2 is not required');
      gf2._done = false;
      runBracket([gf2], new Map([['GF2', gf2]]), seedOf, r2);
    }
  } else if (results.some((r) => isObj(r) && r.match_id === 'GF2')) throw vErr(['results']);
  void origPlace;
  const group = (rs) => rs.map((ms, i) => ({ round: i + 1, matches: ms.map(clean) }));
  return { format: 'double_elim', bracket_size: B, bracket_reset: reset, winners: group(wr), losers: group(lr),
    grand_final: [clean(gf1), ...(gf2 ? [clean(gf2)] : [])] };
}

module.exports = { generate, seedOrder, roundRobin, swiss, singleElim, doubleElim };
