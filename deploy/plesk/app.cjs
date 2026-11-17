'use strict';
// Passenger entry: make sure the API + worker run, then serve the Next.js PWA in this process.
const fs = require('fs');
const http = require('http');
const path = require('path');
const lib = require('./lib.cjs');

for (const [k, v] of Object.entries(lib.readEnv())) if (process.env[k] === undefined) process.env[k] = v;
process.env.NODE_ENV = 'production';

lib.ensure((m) => console.log('[softify]', m)).catch((e) => console.error('[softify] ensure failed:', e));
// Passenger may keep this process alive for a long time: re-check the background services every minute
setInterval(() => lib.ensure().catch(() => {}), 60_000).unref();

const server = path.join(lib.webDir, 'server.js');
if (fs.existsSync(server)) {
  process.chdir(lib.webDir);
  require(server);
} else {
  // Not built yet: answer with a short explanation instead of a Passenger error page
  http.createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>SoftifyOS</h1><p>Η εφαρμογή δεν έχει γίνει build ακόμα. Τρέξε <code>npm run plesk -- deploy</code> (Plesk → Node.js → Run Node.js commands).</p>');
  }).listen(process.env.PORT || 3000);
}
