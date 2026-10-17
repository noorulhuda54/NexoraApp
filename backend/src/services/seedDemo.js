'use strict';
// Demo content for the mobile app: a football league table for league-alpha-1, fixtures with venues/times,
// a roster scenario for the club manager and a pinned product. Recreated identically on every reset.
const { S, put } = require('../state');

function seedDemo() {
  const { createLeague } = require('./standings');
  const { appendEvent } = require('./matches');
  const roster = require('./roster');
  const { roundRobin } = require('./fixtures');
  const club = (club_id, name, venue, lat, lng) => ({ club_id, tenant_id: 'tenant-alpha', name, league_id: 'league-alpha-1',
    home_venue: { venue_id: 'venue-' + club_id, name: venue, lat, lng }, social: { x: '@' + club_id.replace(/-/g, '') },
    staff: [{ name: 'Coach ' + name.split(' ')[1], role: 'coach' }, { name: 'Physio ' + name.split(' ')[1], role: 'physio' }], history: [] });
  put('clubs', 'club-alpha-3', club('club-alpha-3', 'Alpha City', 'City Stadium', 33.71, 73.05));
  put('clubs', 'club-alpha-4', club('club-alpha-4', 'Alpha Athletic', 'Athletic Park', 33.69, 73.02));
  const teams = ['club-alpha-1', 'club-alpha-2', 'club-alpha-3', 'club-alpha-4'];
  const rr = roundRobin(teams, { legs: 1 });
  const fixtures = [];
  rr.rounds.forEach((rd) => rd.matches.forEach((m, i) => {
    const day = 10 + rd.round * 3 + i;
    const venue = S.clubs.get(m.home).home_venue;
    fixtures.push({ match_id: 'demo-' + m.match_id.toLowerCase(), home: m.home, away: m.away, scheduled_at: `2026-10-${String(day).padStart(2, '0')}T15:00:00Z`, venue_id: venue.venue_id });
  }));
  createLeague({ league_id: 'league-alpha-1', sport_id: 'football', teams, fixtures, qualification: { spots: 2 }, lots_seed: S.seed });
  const sl = S.standingsLeagues.get('league-alpha-1'); sl.name = 'Alpha Premier League'; sl.tenant_id = 'tenant-alpha'; put('standingsLeagues', 'league-alpha-1', sl);
  let n = 0;
  const ev = (mid, type, payload = {}) => appendEvent({ event_id: `demo-ev-${++n}`, match_id: mid, type, payload });
  const play = (mid, goals, end = true) => {
    const m = S.matches.get(mid);
    ev(mid, 'match_start');
    for (const [side, k] of goals) for (let i = 0; i < k; i++) ev(mid, 'score', { team_id: m[side + '_team_id'], event_type: 'goal' });
    if (end) ev(mid, 'match_end');
  };
  play(fixtures[0].match_id, [['home', 2], ['away', 1]]);
  play(fixtures[1].match_id, [['home', 1], ['away', 1]]);
  play(fixtures[2].match_id, [['away', 1]], false); // live match
  roster.setup({
    league: { league_id: 'league-alpha-1', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-10-01', close: '2026-12-31' }, max_squad_size: 25, required_positions: { gk: 1 } },
    squads: teams.map((c) => ({ squad_id: c, club_id: c, tenant_id: 'tenant-alpha', name: S.clubs.get(c).name })),
    players: [
      { player_id: 'player-alpha-1', name: 'Ali Khan', position: 'fw', squad_id: 'club-alpha-1', role: 'captain' },
      { player_id: 'player-alpha-3', name: 'Usman Tariq', position: 'gk', squad_id: 'club-alpha-1', role: 'starter' },
      { player_id: 'player-alpha-4', name: 'Saad Malik', position: 'df', squad_id: 'club-alpha-1', role: 'vice_captain' },
      { player_id: 'player-alpha-5', name: 'Hassan Raza', position: 'mf', squad_id: 'club-alpha-1', role: 'substitute' },
      { player_id: 'player-alpha-2', name: 'Bilal Ahmed', position: 'gk', squad_id: 'club-alpha-2', role: 'starter' },
      { player_id: 'player-alpha-6', name: 'Omar Farooq', position: 'df', squad_id: 'club-alpha-2', role: 'captain' },
      { player_id: 'player-alpha-7', name: 'Zain Abbas', position: 'gk', squad_id: 'club-alpha-3', role: 'starter' },
      { player_id: 'player-alpha-8', name: 'Fahad Iqbal', position: 'gk', squad_id: 'club-alpha-4', role: 'starter' },
    ],
    matches_in_progress: [],
  });
  put('pins', fixtures[2].match_id, { match_id: fixtures[2].match_id, product_id: 'prod-jersey-001' });
}
module.exports = { seedDemo };
