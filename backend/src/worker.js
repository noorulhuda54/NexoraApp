'use strict';
// Queue worker: consumes domain events (order status changes, match events, roster moves) from Redis.
const Redis = require('ioredis');
const { QUEUE_KEY } = require('./queue');
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
let processed = 0;
async function loop() {
  for (;;) {
    try {
      const r = await redis.brpop(QUEUE_KEY, 5);
      if (!r) continue;
      const msg = JSON.parse(r[1]);
      processed++;
      console.log(`[worker] #${processed} ${msg.topic} ${JSON.stringify(msg.data).slice(0, 200)}`);
      await redis.hincrby('nascon:worker-stats', msg.topic, 1);
    } catch (e) { console.error('[worker]', e.message); await new Promise((res) => setTimeout(res, 1000)); }
  }
}
loop();
