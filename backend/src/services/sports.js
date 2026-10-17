'use strict';
const { err, vErr, isObj, isInt } = require('../lib');
const { S, put, DEFAULT_TIEBREAK } = require('../state');

const TB_TOKENS = DEFAULT_TIEBREAK;
const OT_POLICIES = ['none', 'extra_time', 'shootout', 'golden_score', 'super_over'];
const KEY_RE = /^[a-z0-9_]{1,40}$/;

function validateTieBreak(v, fields, name = 'tie_break_order') {
  if (v === undefined || v === null) return;
  if (!Array.isArray(v) || v.some((t) => !TB_TOKENS.includes(t)) || new Set(v).size !== v.length) fields.push(name);
}

function createSport(body) {
  const f = [];
  const b = body;
  if (typeof b.sport_id !== 'string' || !/^[a-z0-9_-]{2,40}$/.test(b.sport_id)) f.push('sport_id');
  if (typeof b.name !== 'string' || b.name.length < 1 || b.name.length > 80) f.push('name');
  const model = b.scoring_model;
  if (!['event', 'innings', 'round'].includes(model)) f.push('scoring_model');
  const p = b.periods;
  if (!isObj(p)) f.push('periods');
  else if (model === 'event' && !(isInt(p.count) && p.count >= 1 && isInt(p.duration_minutes) && p.duration_minutes >= 1)) f.push('periods');
  else if (model === 'innings' && !['innings_per_team', 'overs_per_innings', 'balls_per_over', 'wickets_per_innings'].every((k) => isInt(p[k]) && p[k] >= 1)) f.push('periods');
  else if (model === 'round' && !(isInt(p.best_of) && p.best_of >= 1 && p.best_of % 2 === 1)) f.push('periods');
  const se = b.scoring_events;
  if (!isObj(se) || Object.keys(se).length < 1) f.push('scoring_events');
  else {
    for (const [k, v] of Object.entries(se)) {
      let ok = KEY_RE.test(k) && isObj(v);
      if (ok && model === 'event') ok = isInt(v.points) && v.points >= 1;
      if (ok && model === 'innings') ok = isInt(v.runs) && v.runs >= 0 && typeof v.legal_ball === 'boolean' && typeof v.wicket === 'boolean';
      if (ok && model === 'round') ok = isInt(v.rounds) && v.rounds >= 1;
      if (!ok) { f.push('scoring_events'); break; }
    }
  }
  if (typeof b.draw_allowed !== 'boolean') f.push('draw_allowed');
  const ot = b.overtime;
  if (!isObj(ot) || !OT_POLICIES.includes(ot.policy) || (ot.duration_minutes !== undefined && ot.duration_minutes !== null && !(isInt(ot.duration_minutes) && ot.duration_minutes >= 0))) f.push('overtime');
  validateTieBreak(b.tie_break_order, f);
  const r = b.roster;
  if (!isObj(r) || !isInt(r.min_squad_size) || !isInt(r.max_squad_size) || r.min_squad_size < 1 || r.max_squad_size < 1 || r.min_squad_size > r.max_squad_size
    || !isObj(r.required_positions) || Object.values(r.required_positions).some((n) => !isInt(n) || n < 0)) f.push('roster');
  if (f.length) throw vErr(f);
  if (S.sports.has(b.sport_id)) throw err(409, 'SPORT_EXISTS', `Sport ${b.sport_id} already exists.`, { sport_id: b.sport_id });
  const config = {
    sport_id: b.sport_id, name: b.name, scoring_model: model, periods: p, scoring_events: se, draw_allowed: b.draw_allowed,
    overtime: ot, tie_break_order: b.tie_break_order || DEFAULT_TIEBREAK.slice(),
    roster: { min_squad_size: r.min_squad_size, max_squad_size: r.max_squad_size, required_positions: r.required_positions },
  };
  put('sports', b.sport_id, config);
  return { sport_id: b.sport_id, status: 'created', config };
}

module.exports = { createSport, validateTieBreak, TB_TOKENS };
