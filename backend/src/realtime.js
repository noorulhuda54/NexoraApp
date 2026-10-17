'use strict';
// Server-Sent Events hub: GET /api/v1/stream pushes match events, status changes, pins and order updates live.
const clients = new Set();
function attach() { /* SSE uses the Express route; nothing to attach to the raw server */ }
function subscribe(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const c = { res, match: req.query.match_id || null };
  clients.add(c);
  const ka = setInterval(() => res.write(': ka\n\n'), 15000);
  req.on('close', () => { clearInterval(ka); clients.delete(c); });
}
function broadcast(topic, data) {
  const msg = `event: ${topic}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (!c.match || !data || !data.match_id || data.match_id === c.match) c.res.write(msg);
}
module.exports = { attach, subscribe, broadcast, clients };
