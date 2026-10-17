'use strict';
const http = require('http');
const app = require('./app');
const db = require('./db');
const state = require('./state');

async function main() {
  await db.init();
  require('./queue').init();
  const restored = await state.rehydrate().catch(() => false);
  if (!restored) {
    state.baseline(42);
    require('./services/seedDemo').seedDemo();
    await state.persistAll();
  }
  const server = http.createServer(app);
  try { require('./realtime').attach(server); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  const port = Number(process.env.PORT || 8080);
  server.keepAliveTimeout = 65000;
  server.listen(port, '0.0.0.0', () => console.log(`[api] listening on ${port} (db=${db.enabled()}, restored=${restored})`));
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
