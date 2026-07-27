'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const releaseRoot = process.env.CANA_RELEASE_ROOT;
const logs = process.env.CANA_SHARED_LOGS;
const spill = process.env.CANA_EVIDENCE_SPILL;
const portFile = process.env.CANA_PORT_FILE;
for (const [name, value] of Object.entries({ releaseRoot, logs, spill, portFile })) {
  if (!value) throw new Error(`missing ${name}`);
}
const release = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release.json'), 'utf8'));
if (release.environment !== 'CPANEL_SIMULATION') {
  throw new Error('release is not labelled CPANEL_SIMULATION');
}

fs.appendFileSync(
  path.join(logs, 'passenger-web.jsonl'),
  `${JSON.stringify({ event: 'passenger-web-start', gitSha: release.gitSha, at: new Date().toISOString() })}\n`,
);
fs.writeFileSync(
  path.join(spill, `passenger-startup-${release.gitSha}.json`),
  `${JSON.stringify({ environment: 'CPANEL_SIMULATION', gitSha: release.gitSha })}\n`,
);

const staticRoutes = new Set(['/', '/pricing', '/robots.txt', '/sitemap.xml', '/llms.txt']);
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.setHeader('x-cana-environment', 'CPANEL_SIMULATION');
  response.setHeader('strict-transport-security', 'max-age=31536000');
  response.setHeader('content-security-policy', "default-src 'self'");
  if (request.url === '/api/release') {
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify({
      status: 'RELEASE_SHA_PRESENT',
      environment: 'CPANEL_SIMULATION',
      gitSha: release.gitSha,
      artifact: release.artifact,
    }));
    return;
  }
  if (request.url === '/api/health') {
    response.end(JSON.stringify({ status: 'HEALTHY', environment: 'CPANEL_SIMULATION' }));
    return;
  }
  if (request.url === '/api/ready') {
    response.end(JSON.stringify({
      status: 'READY',
      environment: 'CPANEL_SIMULATION',
      gitSha: release.gitSha,
    }));
    return;
  }
  if (staticRoutes.has(request.url)) {
    response.end(JSON.stringify({
      status: 'CPANEL_SIMULATION',
      route: request.url,
      gitSha: release.gitSha,
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ status: 'NOT_FOUND' }));
});

server.listen(Number(process.env.PORT || 0), process.env.HOSTNAME || '127.0.0.1', () => {
  const address = server.address();
  fs.writeFileSync(portFile, `${address.port}\n`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
