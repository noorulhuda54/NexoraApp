'use strict';
// PostgreSQL write-through persistence. The in-process domain state is rebuilt
// from these tables on boot; every mutation is persisted through a serialized queue.
const { Pool } = require('pg');

let pool = null;
let chain = Promise.resolve();
let lastError = null;

function enabled() { return !!pool; }

async function init() {
  if (!process.env.DATABASE_URL) return false;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  for (let i = 0; i < 60; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) {
      if (i === 59) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv (coll TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (coll, id));
    CREATE TABLE IF NOT EXISTS match_events (match_id TEXT NOT NULL, sequence INT NOT NULL, event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, payload JSONB NOT NULL, signature TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (match_id, sequence));
    CREATE TABLE IF NOT EXISTS roster_audit (audit_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS domain_events (id BIGSERIAL PRIMARY KEY, topic TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v JSONB NOT NULL);
    -- append-only guarantees for the event log and the roster audit trail
    CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'append-only table'; END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS match_events_ro ON match_events;
    CREATE TRIGGER match_events_ro BEFORE UPDATE ON match_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
    DROP TRIGGER IF EXISTS roster_audit_ro ON roster_audit;
    CREATE TRIGGER roster_audit_ro BEFORE UPDATE ON roster_audit FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  `);
  return true;
}

function enqueue(fn) {
  if (!pool) return Promise.resolve();
  chain = chain.then(fn).catch((e) => { lastError = e; console.error('[db]', e.message); });
  return chain;
}
const save = (coll, id, data) => enqueue(() => pool.query(
  'INSERT INTO kv (coll,id,data,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()',
  [coll, id, JSON.stringify(data)]));
const remove = (coll, id) => enqueue(() => pool.query('DELETE FROM kv WHERE coll=$1 AND id=$2', [coll, id]));
const appendEvent = (ev) => enqueue(() => pool.query(
  'INSERT INTO match_events (match_id,sequence,event_id,type,payload,signature) VALUES ($1,$2,$3,$4,$5,$6)',
  [ev.match_id, ev.sequence, ev.event_id, ev.type, JSON.stringify(ev.payload), ev.signature]));
const appendAudit = (a) => enqueue(() => pool.query('INSERT INTO roster_audit (audit_id,player_id,data) VALUES ($1,$2,$3)', [a.audit_id, a.player_id, JSON.stringify(a)]));
const domainEvent = (topic, data) => enqueue(() => pool.query('INSERT INTO domain_events (topic,data) VALUES ($1,$2)', [topic, JSON.stringify(data)]));
const setMeta = (k, v) => enqueue(() => pool.query('INSERT INTO meta (k,v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', [k, JSON.stringify(v)]));

async function wipe() {
  if (!pool) return;
  await enqueue(() => pool.query('TRUNCATE kv, match_events, roster_audit, meta'));
}
async function loadAll() {
  if (!pool) return null;
  const kv = await pool.query('SELECT coll,id,data FROM kv');
  const meta = await pool.query('SELECT k,v FROM meta');
  return { kv: kv.rows, meta: Object.fromEntries(meta.rows.map((r) => [r.k, r.v])) };
}
async function ping() {
  if (!pool) return true;
  try { await pool.query('SELECT 1'); return true; } catch (e) { return false; }
}
const flush = () => chain;

module.exports = { init, enabled, save, remove, appendEvent, appendAudit, domainEvent, setMeta, wipe, loadAll, ping, flush, lastError: () => lastError };
