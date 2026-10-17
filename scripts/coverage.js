'use strict';
// Computes COVERAGE.json (line coverage per backend area) from a real lcov report produced by run_tests.sh.
const fs = require('fs');
const lcov = fs.readFileSync(process.argv[2] || 'coverage/lcov.info', 'utf8');
const files = {};
let cur = null;
for (const line of lcov.split('\n')) {
  if (line.startsWith('SF:')) { cur = line.slice(3).replace(/\\/g, '/'); files[cur] = { lf: 0, lh: 0 }; }
  else if (line.startsWith('LF:') && cur) files[cur].lf = Number(line.slice(3));
  else if (line.startsWith('LH:') && cur) files[cur].lh = Number(line.slice(3));
}
const AREAS = {
  fixtures: ['services/fixtures.js'],
  scoring: ['services/matches.js', 'services/sports.js'],
  standings: ['services/standings.js'],
  store: ['services/store.js', 'services/pdf.js'],
  roster: ['services/roster.js'],
  rbac: ['services/rbac.js', 'routes/api.js'],
};
const out = {};
for (const [area, list] of Object.entries(AREAS)) {
  let lf = 0, lh = 0;
  for (const [f, v] of Object.entries(files)) if (list.some((s) => f.endsWith('backend/src/' + s))) { lf += v.lf; lh += v.lh; }
  out[area] = lf ? Math.floor((lh / lf) * 1000) / 10 : 0;
}
fs.writeFileSync('COVERAGE.json', JSON.stringify(out) + '\n');
console.log(JSON.stringify(out));
