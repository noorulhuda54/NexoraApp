'use strict';
// Sections 5.8 / 5.10 — league registration and standings recomputed from event logs on every call.
const { err, vErr, isId, isObj, isInt, lotsKey, round3 } = require('../lib');
const { S, put, DEFAULT_TIEBREAK } = require('../state');
const { newStream, project } = require('./matches');
const { validateTieBreak } = require('./sports');

function createLeague(b) {
  const f = [];
  if (!isId(b.league_id)) f.push('league_id');
  if (!isId(b.sport_id)) f.push('sport_id');
  const teams = b.teams;
  const teamsOk = Array.isArray(teams) && teams.length >= 2 && teams.length <= 40 && teams.every(isId) && new Set(teams).size === teams.length;
  if (!teamsOk) f.push('teams');
  if (!Array.isArray(b.fixtures) || b.fixtures.some((x) => !isObj(x) || !isId(x.match_id) || !isId(x.home) || !isId(x.away) || x.home === x.away
      || (teamsOk && (!teams.includes(x.home) || !teams.includes(x.away))))) f.push('fixtures');
  const pts = b.points === undefined || b.points === null ? {} : b.points;
  if (!isObj(pts) || ['win', 'draw', 'loss'].some((k) => pts[k] !== undefined && !isInt(pts[k]))) f.push('points');
  validateTieBreak(b.tie_break_order, f);
  const q = b.qualification;
  if (!isObj(q) || !isInt(q.spots) || q.spots < 1 || (teamsOk && q.spots > teams.length)) f.push('qualification');
  if (b.lots_seed !== undefined && b.lots_seed !== null && !isInt(b.lots_seed)) f.push('lots_seed');
  if (f.length) throw vErr(f);
  const sport = S.sports.get(b.sport_id);
  if (!sport) throw err(404, 'SPORT_NOT_FOUND', `Sport ${b.sport_id} not found.`, { sport_id: b.sport_id });
  if (S.standingsLeagues.has(b.league_id)) throw err(409, 'LEAGUE_EXISTS', `League ${b.league_id} already exists.`, { league_id: b.league_id });
  const ids = new Set();
  for (const x of b.fixtures) {
    if (S.matches.has(x.match_id) || ids.has(x.match_id)) throw err(409, 'MATCH_EXISTS', `Match ${x.match_id} already exists.`, { match_id: x.match_id });
    ids.add(x.match_id);
  }
  const league = {
    league_id: b.league_id, sport_id: b.sport_id, teams: teams.slice(), fixtures: b.fixtures.map((x) => x.match_id),
    points: { win: pts.win ?? 3, draw: pts.draw ?? 1, loss: pts.loss ?? 0 },
    tie_break_order: b.tie_break_order || sport.tie_break_order || DEFAULT_TIEBREAK,
    qualification_spots: q.spots, lots_seed: b.lots_seed ?? S.seed,
  };
  for (const x of b.fixtures) put('matches', x.match_id, newStream(x.match_id, b.sport_id, x.home, x.away, b.league_id, { scheduled_at: x.scheduled_at || null, venue_id: x.venue_id || null }));
  put('standingsLeagues', b.league_id, league);
  return { league_id: b.league_id, status: 'created', team_count: teams.length, fixture_count: b.fixtures.length };
}

function computeStandings(leagueId) {
  const L = S.standingsLeagues.get(leagueId);
  if (!L) throw err(404, 'LEAGUE_NOT_FOUND', `League ${leagueId} not found.`, { league_id: leagueId });
  const sport = S.sports.get(L.sport_id);
  const model = sport.scoring_model;
  const per = sport.periods || {};
  const W = L.points.win;
  // per-match results
  const played = [];
  const remaining = Object.fromEntries(L.teams.map((t) => [t, 0]));
  for (const mid of L.fixtures) {
    const m = S.matches.get(mid);
    const p = project(m);
    if (p.status === 'completed' && p.outcome !== 'undecided') {
      const oversOf = (side) => {
        if (model !== 'innings') return 0;
        const x = p.raw[side];
        if (x.wickets >= per.wickets_per_innings * per.innings_per_team) return per.overs_per_innings * per.innings_per_team;
        return x.balls / per.balls_per_over;
      };
      played.push({ home: m.home_team_id, away: m.away_team_id, hs: p.raw.home.score, as: p.raw.away.score,
        hfp: p.raw.home.fair_play, afp: p.raw.away.fair_play, outcome: p.outcome, hov: oversOf('home'), aov: oversOf('away') });
    } else {
      if (remaining[m.home_team_id] !== undefined) remaining[m.home_team_id]++;
      if (remaining[m.away_team_id] !== undefined) remaining[m.away_team_id]++;
    }
  }
  // aggregate over a set of matches for a set of teams
  function agg(teamSet, onlyAmong) {
    const r = {};
    for (const t of teamSet) r[t] = { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, points: 0, fair_play: 0, oversFaced: 0, oversBowled: 0 };
    for (const g of played) {
      if (onlyAmong && !(onlyAmong.has(g.home) && onlyAmong.has(g.away))) continue;
      for (const [t, o, sf, sa, fp, ovf, ovb, res] of [
        [g.home, g.away, g.hs, g.as, g.hfp, g.hov, g.aov, g.outcome === 'home_win' ? 'w' : g.outcome === 'away_win' ? 'l' : 'd'],
        [g.away, g.home, g.as, g.hs, g.afp, g.aov, g.hov, g.outcome === 'away_win' ? 'w' : g.outcome === 'home_win' ? 'l' : 'd']]) {
        if (!r[t]) continue;
        void o;
        const x = r[t];
        x.played++; x.scored += sf; x.conceded += sa; x.fair_play += fp; x.oversFaced += ovf; x.oversBowled += ovb;
        if (res === 'w') { x.won++; x.points += L.points.win; } else if (res === 'l') { x.lost++; x.points += L.points.loss; } else { x.drawn++; x.points += L.points.draw; }
      }
    }
    for (const t of Object.keys(r)) {
      const x = r[t];
      if (model === 'innings') {
        const rf = x.oversFaced > 0 ? x.scored / x.oversFaced : 0;
        const ra = x.oversBowled > 0 ? x.conceded / x.oversBowled : 0;
        x.diff = round3(rf - ra);
      } else x.diff = x.scored - x.conceded;
    }
    return r;
  }
  const overall = agg(L.teams, null);
  const order = L.tie_break_order.includes('draw_lots') ? L.tie_break_order : [...L.tie_break_order, 'draw_lots'];
  const lots = Object.fromEntries(L.teams.map((t) => [t, lotsKey(L.lots_seed, L.league_id, t)]));
  function resolve(group) {
    for (const c of order) {
      if (c === 'draw_lots') {
        const sorted = group.slice().sort((a, b) => (lots[a] < lots[b] ? -1 : lots[a] > lots[b] ? 1 : 0));
        return sorted.map((t, i) => ({ t, by: i < sorted.length - 1 ? 'draw_lots' : null }));
      }
      let val;
      if (c === 'h2h_points' || c === 'h2h_diff') {
        const mini = agg(group, new Set(group));
        val = (t) => (c === 'h2h_points' ? mini[t].points : mini[t].diff);
      } else if (c === 'overall_diff') val = (t) => overall[t].diff;
      else if (c === 'scored') val = (t) => overall[t].scored;
      else val = (t) => overall[t].fair_play;
      const vals = new Map(group.map((t) => [t, val(t)]));
      const distinct = [...new Set(vals.values())].sort((a, b) => b - a);
      if (distinct.length === 1) continue;
      const out = [];
      distinct.forEach((v, gi) => {
        const sub = group.filter((t) => vals.get(t) === v);
        const res = sub.length > 1 ? resolve(sub) : [{ t: sub[0], by: null }];
        if (gi < distinct.length - 1) res[res.length - 1].by = c;
        out.push(...res);
      });
      return out;
    }
    return group.map((t) => ({ t, by: null }));
  }
  const byPoints = [...new Set(L.teams.map((t) => overall[t].points))].sort((a, b) => b - a);
  const ordered = [];
  for (const pv of byPoints) {
    const grp = L.teams.filter((t) => overall[t].points === pv);
    if (grp.length === 1) ordered.push({ t: grp[0], by: null });
    else { const r = resolve(grp); r[r.length - 1].by = null; ordered.push(...r); }
  }
  const k = L.qualification_spots;
  const maxP = (t) => overall[t].points + W * remaining[t];
  const status = (t) => {
    const others = L.teams.filter((x) => x !== t);
    if (others.filter((x) => maxP(x) >= overall[t].points).length < k) return 'clinched';
    if (others.filter((x) => overall[x].points > maxP(t)).length >= k) return 'eliminated';
    return 'still_possible';
  };
  const table = ordered.map(({ t, by }, i) => {
    const x = overall[t];
    return { rank: i + 1, team_id: t, played: x.played, won: x.won, drawn: x.drawn, lost: x.lost, scored: x.scored, conceded: x.conceded,
      diff: x.diff, points: x.points, fair_play: x.fair_play, status: status(t), resolved_by: by };
  });
  const h2h = {};
  for (const a of L.teams) {
    h2h[a] = {};
    for (const b of L.teams) {
      if (a === b) continue;
      const r = agg([a, b], new Set([a, b]))[a];
      h2h[a][b] = { played: r.played, points: r.points, scored: r.scored, conceded: r.conceded };
    }
  }
  return { league_id: L.league_id, sport_id: L.sport_id, qualification_spots: k, table, h2h };
}

module.exports = { createLeague, computeStandings };
