'use strict';
const express = require('express');
const { ApiError, err, vErr, isObj, isInt } = require('./lib');
const state = require('./state');
const db = require('./db');
const { S } = state;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// Body parsing: JSON only, 1 MB limit (413), malformed → 400.
app.use(express.json({ limit: '1mb', type: () => true, strict: false }));

const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.then) r.catch(next); } catch (e) { next(e); } };
const body = (req) => {
  const b = req.body;
  if (b === undefined || (isObj(b) && Object.keys(b).length === 0 && !req.headers['content-length'] && !req.headers['transfer-encoding'])) return {};
  if (!isObj(b)) throw vErr(['body'], 'Request body must be a JSON object');
  return b;
};
app.locals.body = body;
app.locals.wrap = wrap;

app.get('/health', wrap(async (req, res) => {
  const ok = S.seeded && (await db.ping());
  if (!ok) return res.status(503).json({ error: { code: 'NOT_READY', message: 'Not ready', details: {} } });
  res.json({ status: 'ok' });
}));

app.post('/audit/v1/reset', wrap(async (req, res) => {
  const b = body(req);
  const f = [];
  let seed = 42;
  if (b.seed !== undefined && b.seed !== null) { if (!isInt(b.seed)) f.push('seed'); else seed = b.seed; }
  let stock;
  if (b.stock !== undefined && b.stock !== null) {
    if (!isObj(b.stock) || Object.values(b.stock).some((v) => !isInt(v) || v < 0)) f.push('stock');
    else stock = b.stock;
  }
  if (f.length) throw vErr(f);
  const known = {};
  if (stock) for (const [k, v] of Object.entries(stock)) if (k === 'var-jersey-001-M' || k === 'var-jersey-001-L') known[k] = v;
  const effective = state.baseline(seed, known);
  require('./services/seedDemo').seedDemo();
  await state.persistAll();
  res.json({ status: 'reset_complete', seed, sports: ['football', 'basketball', 'cricket', 'esports'], tenants: ['tenant-alpha', 'tenant-beta'], stock: effective });
}));

app.post('/audit/v1/sports', wrap((req, res) => {
  res.status(201).json(require('./services/sports').createSport(body(req)));
}));

for (const mod of ['./routes/audit', './routes/api']) {
  try { require(mod)(app); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes(mod.slice(2))) throw e; }
}

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, details: {} } }));

// eslint-disable-next-line no-unused-vars
app.use((e, req, res, next) => {
  if (e instanceof ApiError) return res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details || {} } });
  if (e.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 1 MB.', details: {} } });
  if (e.type === 'entity.parse.failed' || e instanceof SyntaxError || e.status === 400) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.', details: { fields: ['body'] } } });
  console.error(e);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.', details: {} } });
});

module.exports = app;
