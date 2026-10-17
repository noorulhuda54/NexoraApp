'use strict';
// Authenticated production API used by the mobile app. Every route enforces the RBAC policy and tenant isolation.
const crypto = require('crypto');
const { err, vErr, isObj } = require('../lib');
const { S, put, DEMO_PASSWORD } = require('../state');
const rbac = require('../services/rbac');
const matches = require('../services/matches');
const standings = require('../services/standings');
const roster = require('../services/roster');
const store = require('../services/store');
const sync = require('../services/sync');
const realtime = require('../realtime');
const { receiptPdf } = require('../services/pdf');

const pwHash = (pw) => crypto.createHash('sha256').update('nascon|' + pw).digest('hex');
const DEMO_HASH = pwHash(DEMO_PASSWORD);

module.exports = (app) => {
  const { wrap, body } = app.locals;
  const R = '/api/v1';
  const auth = (req) => rbac.authenticate(req);
  const tenantOf = (c) => c.tenant_id;
  const sameTenant = (c, t) => c.role === 'super_admin' || c.tenant_id === t;
  const leagueOfMatch = (m) => (m.league_id ? S.leagues.get(m.league_id) || S.standingsLeagues.get(m.league_id) : null);

  app.post(`${R}/auth/login`, wrap((req, res) => {
    const b = body(req);
    if (typeof b.email !== 'string' || typeof b.password !== 'string') throw vErr(['email', 'password'].filter((k) => typeof b[k] !== 'string'));
    const u = S.users.get(b.email.trim().toLowerCase());
    if (!u || pwHash(b.password) !== DEMO_HASH) throw err(401, 'UNAUTHENTICATED', 'Email or password is incorrect.', {});
    const tenant = u.tenant_id ? S.tenants.get(u.tenant_id) : null;
    res.json({ token: rbac.tokenFor(u), user: { user_id: u.user_id, email: u.email, name: u.name, role: u.role, tenant_id: u.tenant_id, club_id: u.club_id || null, player_id: u.player_id || null, league_ids: u.league_ids || [] }, tenant });
  }));

  app.get(`${R}/me`, wrap((req, res) => {
    const c = auth(req);
    const u = S.users.get(c.email);
    res.json({ user: u, tenant: c.tenant_id ? S.tenants.get(c.tenant_id) : null });
  }));

  app.get(`${R}/leagues`, wrap((req, res) => {
    const c = auth(req);
    res.json({ leagues: [...S.standingsLeagues.values()].filter((l) => l.tenant_id && sameTenant(c, l.tenant_id))
      .map((l) => ({ league_id: l.league_id, name: l.name || l.league_id, sport_id: l.sport_id, team_count: l.teams.length })) });
  }));

  const matchSummary = (m) => {
    const p = matches.project(m);
    if (m.admin_status) p.status = m.admin_status;
    const club = (id) => S.clubs.get(id);
    return { match_id: m.match_id, league_id: m.league_id, sport_id: m.sport_id, status: p.status, outcome: p.outcome, scheduled_at: m.scheduled_at || null,
      venue: m.venue_id ? (club(m.home_team_id) || {}).home_venue || null : null,
      home: { team_id: m.home_team_id, name: (club(m.home_team_id) || {}).name || m.home_team_id, score: p.home.score },
      away: { team_id: m.away_team_id, name: (club(m.away_team_id) || {}).name || m.away_team_id, score: p.away.score }, version: m.events.length };
  };
  const visibleMatch = (c, m) => { const l = leagueOfMatch(m); return l && l.tenant_id ? sameTenant(c, l.tenant_id) : c.role === 'super_admin'; };

  app.get(`${R}/matches`, wrap((req, res) => {
    const c = auth(req);
    const list = [...S.matches.values()].filter((m) => visibleMatch(c, m) && (!req.query.league_id || m.league_id === req.query.league_id));
    list.sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    res.json({ matches: list.map(matchSummary) });
  }));

  app.get(`${R}/matches/:id`, wrap((req, res) => {
    const c = auth(req);
    const m = S.matches.get(req.params.id);
    if (!m) throw err(404, 'MATCH_NOT_FOUND', 'Match not found.', { match_id: req.params.id });
    if (!visibleMatch(c, m)) throw err(403, 'FORBIDDEN', 'You cannot view this match.', {});
    const pin = S.pins.get(m.match_id);
    const product = pin ? productView(S.products.get(pin.product_id)) : null;
    res.json({ ...matchSummary(m), score: matches.scoreView(m), pinned_product: product,
      sport: S.sports.get(m.sport_id), can_score: rbac.can(c, 'match.score', leagueOfMatch(m)) });
  }));

  app.post(`${R}/matches/:id/pin`, wrap((req, res) => {
    const c = auth(req);
    const b = body(req);
    const m = S.matches.get(req.params.id);
    if (!m) throw err(404, 'MATCH_NOT_FOUND', 'Match not found.', {});
    const p = S.products.get(b.product_id);
    if (!p) throw err(404, 'PRODUCT_NOT_FOUND', 'Product not found.', {});
    rbac.authorize(c, 'club.products.write', S.clubs.get(p.club_id));
    put('pins', m.match_id, { match_id: m.match_id, product_id: p.product_id });
    realtime.broadcast('product.pinned', { match_id: m.match_id, product_id: p.product_id });
    res.status(201).json({ match_id: m.match_id, product_id: p.product_id });
  }));

  app.get(`${R}/standings/:league_id`, wrap((req, res) => {
    const c = auth(req);
    const l = S.standingsLeagues.get(req.params.league_id);
    if (!l) throw err(404, 'LEAGUE_NOT_FOUND', 'League not found.', {});
    if (l.tenant_id && !sameTenant(c, l.tenant_id)) throw err(403, 'FORBIDDEN', 'Not your tenant.', {});
    const s = standings.computeStandings(l.league_id);
    s.table = s.table.map((r) => ({ ...r, name: (S.clubs.get(r.team_id) || {}).name || r.team_id }));
    res.json({ ...s, name: l.name || l.league_id });
  }));

  const rosterOf = (clubId) => {
    const out = [];
    for (const r of S.registry.values()) for (const [lid, st] of Object.entries(r.leagues)) {
      const reg = st.registration;
      if (reg && reg.squad_id === clubId) out.push({ player_id: r.player_id, name: r.name, position: r.position, role: reg.role, league_id: lid, registration_type: reg.registration_type, parent_squad_id: reg.parent_squad_id, loan_end_date: reg.loan_end_date });
    }
    return out;
  };
  app.get(`${R}/clubs`, wrap((req, res) => {
    const c = auth(req);
    res.json({ clubs: [...S.clubs.values()].filter((cl) => sameTenant(c, cl.tenant_id)).map((cl) => ({ club_id: cl.club_id, name: cl.name, home_venue: cl.home_venue, tenant_id: cl.tenant_id })) });
  }));
  app.get(`${R}/clubs/:id`, wrap((req, res) => {
    const c = auth(req);
    const cl = S.clubs.get(req.params.id);
    if (!cl) throw err(404, 'CLUB_NOT_FOUND', 'Club not found.', {});
    rbac.authorize(c, 'club.read', cl);
    res.json({ ...cl, tenant: S.tenants.get(cl.tenant_id), roster: rosterOf(cl.club_id), can_manage: rbac.can(c, 'club.roster.write', cl),
      transfer_targets: [...S.clubs.values()].filter((x) => x.tenant_id === cl.tenant_id && x.club_id !== cl.club_id).map((x) => ({ club_id: x.club_id, name: x.name })) });
  }));

  const productView = (p) => p && ({ ...p, variants: p.variant_ids.map((id) => { const v = S.variants.get(id); return { variant_id: id, size: v.size, color: v.color, price_minor: store.currentPrice(v), currency: v.currency, stock: v.stock }; }) });
  app.get(`${R}/products`, wrap((req, res) => {
    const c = auth(req);
    res.json({ products: [...S.products.values()].filter((p) => sameTenant(c, p.tenant_id)).map(productView) });
  }));
  app.post(`${R}/checkout`, wrap(async (req, res) => {
    const c = auth(req);
    const b = body(req);
    const r = await store.checkout({ ...b, customer_id: c.sub });
    res.status(r.status).json(r.body);
  }));
  app.get(`${R}/orders`, wrap((req, res) => {
    const c = auth(req);
    res.json({ orders: [...S.orders.values()].filter((o) => o.customer_id === c.sub).map((o) => ({ order_id: o.order_id, status: o.status, total_minor: o._response.total_minor, paid_at: o._response.receipt.payload.paid_at })) });
  }));
  app.get(`${R}/orders/:id/receipt.pdf`, wrap((req, res) => {
    const c = auth(req);
    const o = S.orders.get(req.params.id);
    if (!o) throw err(404, 'ORDER_NOT_FOUND', 'Order not found.', {});
    if (o.customer_id !== c.sub && c.role !== 'super_admin') throw err(403, 'FORBIDDEN', 'Not your order.', {});
    res.type('application/pdf').send(receiptPdf(o._response.receipt.payload));
  }));

  // Writes: scoring (league organizer) and roster moves (club manager).
  const canScoreEvent = (c, p) => {
    const m = S.matches.get(p.match_id);
    return rbac.can(c, 'match.score', m ? leagueOfMatch(m) : null);
  };
  const canRoster = (c, p) => {
    const sq = S.squads.get(p.from_squad_id);
    const cl = sq && sq.club_id ? S.clubs.get(sq.club_id) : null;
    return c.role === 'super_admin' || (c.role === 'club_manager' && sq && sq.tenant_id === c.tenant_id && sq.club_id === c.club_id && (!cl || cl.tenant_id === c.tenant_id));
  };
  app.post(`${R}/events`, wrap((req, res) => {
    const c = auth(req);
    const b = body(req);
    if (!isObj(b) || !canScoreEvent(c, b)) throw err(403, 'FORBIDDEN', 'Only the league organizer can record match events.', {});
    const r = matches.appendEvent(b);
    res.status(r.status).json(r.body);
  }));
  app.post(`${R}/roster/transfer`, wrap((req, res) => {
    const c = auth(req);
    const b = body(req);
    if (!canRoster(c, b)) throw err(403, 'FORBIDDEN', 'Only the club manager can move players from this squad.', {});
    const r = roster.transfer({ ...b, requested_by: c.sub });
    res.status(r.status).json(r.body);
  }));
  app.get(`${R}/roster/history/:player_id`, wrap((req, res) => { auth(req); res.json(roster.history(req.params.player_id, req.query.as_of)); }));
  app.post(`${R}/sync`, wrap((req, res) => {
    const c = auth(req);
    const b = body(req);
    // actions the caller may not perform are rejected per action (server wins) without being applied
    const allowed = Array.isArray(b.actions) ? b.actions.map((a) => isObj(a) && isObj(a.payload) && (a.type === 'score_event' ? canScoreEvent(c, a.payload) : canRoster(c, a.payload))) : [];
    res.json(sync.sync(b, { allowed }));
  }));
  app.get(`${R}/stream`, (req, res) => realtime.subscribe(req, res));

  // Scheduling (league organizer of the match's league) and order fulfilment (club manager / super admin).
  const schedule = require('../services/schedule');
  const organizerOf = (c, mid) => { const m = S.matches.get(mid); if (!m) throw err(404, 'MATCH_NOT_FOUND', 'Match not found.', {}); rbac.authorize(c, 'match.score', leagueOfMatch(m)); };
  app.post(`${R}/matches/:id/reschedule`, wrap((req, res) => { const c = auth(req); organizerOf(c, req.params.id); res.json(schedule.reschedule(req.params.id, body(req))); }));
  app.post(`${R}/matches/:id/status`, wrap((req, res) => {
    const c = auth(req); organizerOf(c, req.params.id);
    const r = schedule.setStatus(req.params.id, body(req));
    realtime.broadcast('match.status', { match_id: r.match_id, status: r.status });
    res.json(r);
  }));
  app.post(`${R}/orders/:id/status`, wrap((req, res) => {
    const c = auth(req);
    const o = S.orders.get(req.params.id);
    if (!o) throw err(404, 'ORDER_NOT_FOUND', 'Order not found.', {});
    const item = o._response.items[0];
    const product = item ? S.products.get((S.variants.get(item.variant_id) || {}).product_id) : null;
    rbac.authorize(c, 'club.products.write', product ? S.clubs.get(product.club_id) : {});
    res.json(store.transitionOrder(req.params.id, body(req).status));
  }));
  void tenantOf;
};
