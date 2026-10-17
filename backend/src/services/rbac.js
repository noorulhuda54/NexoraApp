'use strict';
// Section 5.13 / FR-5.1 — policy-as-code RBAC with strict tenant isolation.
const { err, jwtSign, jwtVerify } = require('../lib');
const { S } = require('../state');

function tokenFor(user) {
  return jwtSign({ sub: user.user_id, email: user.email, role: user.role, tenant_id: user.tenant_id || null,
    league_ids: user.league_ids || [], club_id: user.club_id || null, player_id: user.player_id || null });
}
function matrix() {
  const u = (e) => S.users.get(e);
  return {
    tokens: { super_admin: tokenFor(u('admin@nascon.test')), league_organizer: tokenFor(u('organizer@nascon.test')), club_manager: tokenFor(u('manager@nascon.test')),
      player: tokenFor(u('player@nascon.test')), viewer: tokenFor(u('viewer@nascon.test')) },
    context: { tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta', own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2',
      foreign_league_id: 'league-beta-1', own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
      own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1' },
  };
}

function authenticate(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  const claims = m ? jwtVerify(m[1]) : null;
  if (!claims) throw err(401, 'UNAUTHENTICATED', 'Missing or invalid token.', {});
  return claims;
}
const forbidden = () => err(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});

// action → (claims, resource) → boolean
const POLICY = {
  'tenant.create': (c) => c.role === 'super_admin',
  'platform.config': (c) => c.role === 'super_admin',
  'league.fixtures.write': (c, l) => c.role === 'super_admin' || (c.role === 'league_organizer' && c.tenant_id === l.tenant_id && c.league_ids.includes(l.league_id)),
  'club.roster.write': (c, cl) => c.role === 'super_admin' || (c.role === 'club_manager' && c.tenant_id === cl.tenant_id && c.club_id === cl.club_id),
  'club.products.write': (c, cl) => c.role === 'super_admin' || (c.role === 'club_manager' && c.tenant_id === cl.tenant_id && c.club_id === cl.club_id),
  'player.update': (c, p) => c.role === 'super_admin' || (c.role === 'club_manager' && c.tenant_id === p.tenant_id && c.club_id === p.club_id)
    || (c.role === 'player' && c.tenant_id === p.tenant_id && c.player_id === p.player_id),
  'club.read': (c, cl) => c.role === 'super_admin' || (c.tenant_id === cl.tenant_id),
  'match.score': (c, l) => c.role === 'super_admin' || (c.role === 'league_organizer' && (!l || (c.tenant_id === l.tenant_id && c.league_ids.includes(l.league_id)))),
  'roster.manage': (c, cl) => c.role === 'super_admin' || (c.role === 'club_manager' && (!cl || c.club_id === cl.club_id)),
};
function can(claims, action, resource) { return !!POLICY[action](claims, resource || {}); }
function authorize(claims, action, resource) { if (!can(claims, action, resource)) throw forbidden(); }

function probe(req, kind, id) {
  const c = authenticate(req);
  const need = (coll, code, label) => {
    const r = S[coll].get(id);
    if (!r) throw err(404, code, `${label} ${id} not found.`, { [label.toLowerCase() + '_id']: id });
    return r;
  };
  switch (kind) {
    case 'P1': authorize(c, 'tenant.create'); break;
    case 'P2': authorize(c, 'league.fixtures.write', need('leagues', 'LEAGUE_NOT_FOUND', 'League')); break;
    case 'P3': authorize(c, 'club.roster.write', need('clubs', 'CLUB_NOT_FOUND', 'Club')); break;
    case 'P4': authorize(c, 'club.products.write', need('clubs', 'CLUB_NOT_FOUND', 'Club')); break;
    case 'P5': authorize(c, 'player.update', need('players', 'PLAYER_NOT_FOUND', 'Player')); break;
    case 'P6': authorize(c, 'club.read', need('clubs', 'CLUB_NOT_FOUND', 'Club')); break;
    case 'P7': authorize(c, 'platform.config'); break;
    default: throw forbidden();
  }
  return { authorized: true };
}

module.exports = { matrix, authenticate, authorize, can, probe, tokenFor };
