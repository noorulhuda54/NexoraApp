'use strict';
// In-process domain state. Collections are Maps persisted write-through to PostgreSQL (db.js).
const db = require('./db');
const { clone } = require('./lib');

const COLLS = ['sports', 'tenants', 'leagues', 'clubs', 'players', 'users', 'matches', 'standingsLeagues',
  'rosterLeagues', 'squads', 'registry', 'transferReqs', 'products', 'variants', 'orders', 'syncActions', 'pins', 'venues'];

const S = { seeded: false, seed: 42, counters: {} };
for (const c of COLLS) S[c] = new Map();

function put(coll, id, obj) { S[coll].set(id, obj); db.save(coll, id, obj); return obj; }
function touch(coll, id) { const o = S[coll].get(id); if (o) db.save(coll, id, o); }
function del(coll, id) { S[coll].delete(id); db.remove(coll, id); }
function nextCounter(name) { S.counters[name] = (S.counters[name] || 0) + 1; db.setMeta('counters', S.counters); return S.counters[name]; }

const DEFAULT_TIEBREAK = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];

const BASE_SPORTS = [
  { sport_id: 'football', name: 'Football', scoring_model: 'event', periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } }, draw_allowed: true, overtime: { policy: 'none' },
    tie_break_order: DEFAULT_TIEBREAK, roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } } },
  { sport_id: 'basketball', name: 'Basketball', scoring_model: 'event', periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } }, draw_allowed: false,
    overtime: { policy: 'extra_time', duration_minutes: 5 }, tie_break_order: DEFAULT_TIEBREAK,
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} } },
  { sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false }, single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false }, four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false }, wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false }, wicket: { runs: 0, legal_ball: true, wicket: true } },
    draw_allowed: true, overtime: { policy: 'super_over' }, tie_break_order: DEFAULT_TIEBREAK,
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } } },
  { sport_id: 'esports', name: 'Esports', scoring_model: 'round', periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } }, draw_allowed: false, overtime: { policy: 'none' },
    tie_break_order: DEFAULT_TIEBREAK, roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} } },
];

const DEMO_PASSWORD = 'Nascon@26';
const DEMO_USERS = [
  { user_id: 'user-admin', email: 'admin@nascon.test', name: 'Platform Admin', role: 'super_admin', tenant_id: null },
  { user_id: 'user-organizer', email: 'organizer@nascon.test', name: 'League Organizer', role: 'league_organizer', tenant_id: 'tenant-alpha', league_ids: ['league-alpha-1'] },
  { user_id: 'user-manager', email: 'manager@nascon.test', name: 'Club Manager', role: 'club_manager', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1' },
  { user_id: 'user-player', email: 'player@nascon.test', name: 'Player Alpha One', role: 'player', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', player_id: 'player-alpha-1' },
  { user_id: 'user-viewer', email: 'viewer@nascon.test', name: 'General Viewer', role: 'viewer', tenant_id: 'tenant-alpha' },
];

function baseline(seed, stockOverride) {
  for (const c of COLLS) S[c].clear();
  S.counters = {};
  S.seed = seed;
  S.eventIndex = null;
  for (const sp of BASE_SPORTS) S.sports.set(sp.sport_id, clone(sp));
  S.tenants.set('tenant-alpha', { tenant_id: 'tenant-alpha', name: 'Alpha Sports', logo: 'AS', colors: { primary: '#1F4E79', accent: '#F2A900' } });
  S.tenants.set('tenant-beta', { tenant_id: 'tenant-beta', name: 'Beta Athletics', logo: 'BA', colors: { primary: '#2E6B3A', accent: '#C8102E' } });
  S.leagues.set('league-alpha-1', { league_id: 'league-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha Premier League', sport_id: 'football', season: '2026', organizer_user_id: 'user-organizer' });
  S.leagues.set('league-alpha-2', { league_id: 'league-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Championship', sport_id: 'football', season: '2026', organizer_user_id: null });
  S.leagues.set('league-beta-1', { league_id: 'league-beta-1', tenant_id: 'tenant-beta', name: 'Beta Cup', sport_id: 'basketball', season: '2026', organizer_user_id: null });
  const club = (club_id, tenant_id, name, league_id, venue, lat, lng) => ({ club_id, tenant_id, name, league_id,
    home_venue: { venue_id: 'venue-' + club_id, name: venue, lat, lng }, social: { x: '@' + club_id.replace(/-/g, ''), instagram: '@' + club_id.replace(/-/g, '') },
    staff: [{ name: 'Coach ' + name.split(' ')[0], role: 'coach' }, { name: 'Manager ' + name.split(' ')[0], role: 'manager' }, { name: 'Physio ' + name.split(' ')[0], role: 'physio' }],
    history: [{ season: '2025', played: 10, won: 6, drawn: 2, lost: 2 }] });
  S.clubs.set('club-alpha-1', club('club-alpha-1', 'tenant-alpha', 'Alpha United', 'league-alpha-1', 'Alpha Arena', 33.6844, 73.0479));
  S.clubs.set('club-alpha-2', club('club-alpha-2', 'tenant-alpha', 'Alpha Rovers', 'league-alpha-1', 'Rovers Ground', 33.7, 73.06));
  S.clubs.set('club-beta-1', club('club-beta-1', 'tenant-beta', 'Beta Hawks', 'league-beta-1', 'Hawks Court', 31.5204, 74.3587));
  S.players.set('player-alpha-1', { player_id: 'player-alpha-1', name: 'Ali Khan', position: 'fw', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', role: 'captain' });
  S.players.set('player-alpha-2', { player_id: 'player-alpha-2', name: 'Bilal Ahmed', position: 'gk', club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', role: 'starter' });
  S.players.set('player-beta-1', { player_id: 'player-beta-1', name: 'Hamza Ali', position: 'pg', club_id: 'club-beta-1', tenant_id: 'tenant-beta', role: 'starter' });
  for (const u of DEMO_USERS) S.users.set(u.email, clone(u));
  S.products.set('prod-jersey-001', { product_id: 'prod-jersey-001', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', name: 'Alpha United Home Jersey 2026',
    category: 'apparel', description: 'Official home jersey.', variant_ids: ['var-jersey-001-M', 'var-jersey-001-L'] });
  const stock = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5, ...(stockOverride || {}) };
  for (const [vid, size] of [['var-jersey-001-M', 'M'], ['var-jersey-001-L', 'L']]) {
    S.variants.set(vid, { variant_id: vid, product_id: 'prod-jersey-001', size, color: 'Blue', price_minor: 450000, currency: 'PKR',
      price_schedule: [], stock: stock[vid], reserved: 0 });
  }
  S.seeded = true;
  return stock;
}

async function persistAll() {
  await db.wipe();
  for (const c of COLLS) for (const [id, o] of S[c]) db.save(c, id, o);
  // mirror the append-only logs created while seeding
  for (const m of S.matches.values()) for (const e of m.events) db.appendEvent({ match_id: m.match_id, ...e });
  for (const r of S.registry.values()) for (const l of Object.values(r.leagues)) for (const a of l.history) db.appendAudit(a);
  db.setMeta('seed', S.seed); db.setMeta('counters', S.counters); db.setMeta('seeded', true);
  await db.flush();
}

async function rehydrate() {
  const data = await db.loadAll();
  if (!data || !data.meta.seeded) return false;
  for (const c of COLLS) S[c].clear();
  for (const r of data.kv) if (S[r.coll]) S[r.coll].set(r.id, r.data);
  S.eventIndex = null;
  S.seed = data.meta.seed ?? 42; S.counters = data.meta.counters || {}; S.seeded = true;
  return true;
}

module.exports = { S, put, touch, del, nextCounter, baseline, persistAll, rehydrate, DEFAULT_TIEBREAK, DEMO_PASSWORD };
