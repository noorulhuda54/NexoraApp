'use strict';
// /api/v1/* — production routes used by the mobile app (rate limited: 100 req / rolling 10 s / client IP).
const { err } = require('../lib');

const WINDOW_MS = 10000, LIMIT = 100;
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    hits.set(ip, arr);
    const retry = Math.max(1, Math.ceil((WINDOW_MS - (now - arr[0])) / 1000));
    res.set('Retry-After', String(retry));
    return next(err(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', { retry_after_seconds: retry }));
  }
  arr.push(now); hits.set(ip, arr);
  next();
}

module.exports = (app) => {
  app.use('/api/v1', rateLimit);
  app.get('/api/v1/ping', (req, res) => res.json({ pong: true }));
  try { require('./mobile')(app); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
};
module.exports.resetRateLimit = () => hits.clear();
