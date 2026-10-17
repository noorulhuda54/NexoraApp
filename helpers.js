'use strict';
// Starts the Express app in-process (no DB/Redis) on an ephemeral port and exposes a JSON client.
process.env.DAY1_SALT = process.env.DAY1_SALT || 'demo-salt';
const http = require('http');
const app = require('../backend/src/app');
const state = require('../backend/src/state');
state.baseline(42);
try { require('../backend/src/services/seedDemo').seedDemo(); } catch (e) { /* optional */ }
let server, base;
async function start() {
  if (server) return base;
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
async function call(method, path, body, headers = {}) {
  await start();
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);
function stop() { if (server) server.close(); server = null; }
module.exports = { call, post, get, stop, start };
