'use strict';
// Internal job queue: domain events are pushed to a Redis list consumed by the worker service.
// Falls back to an in-process array when REDIS_URL is not configured (unit tests).
const db = require('./db');
let redis = null;
const memory = [];
const QUEUE_KEY = 'nascon:domain-events';

function init() {
  if (!process.env.REDIS_URL) return;
  const Redis = require('ioredis');
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: true, lazyConnect: false });
  redis.on('error', (e) => console.error('[queue]', e.message));
}
function publish(topic, data) {
  const msg = { topic, data, at: new Date().toISOString() };
  db.domainEvent(topic, data);
  if (redis) redis.lpush(QUEUE_KEY, JSON.stringify(msg)).catch(() => memory.push(msg));
  else { memory.push(msg); if (memory.length > 1000) memory.shift(); }
  try { require('./realtime').broadcast(topic, data); } catch (e) { /* realtime optional */ }
}
module.exports = { init, publish, memory, QUEUE_KEY };
