/**
 * cPanel / Phusion Passenger startup file for the orderweeddc artifact.
 *
 * This file sits at the ARTIFACT root (next to server.js, .next/static,
 * and public/). Passenger launches it; it hardens the runtime defaults
 * and hands off to the Next.js standalone server, which honors PORT and
 * HOSTNAME from the environment (Passenger supplies PORT).
 *
 * No secrets live here. All configuration arrives via the cPanel
 * "Setup Node.js App" environment-variable panel.
 */
'use strict';

process.env.NODE_ENV = 'production';

// The production SQLite file is persistent state owned outside each release.
// Do not let application startup rewrite its file-level journal mode. Connection-
// local safety settings are still applied by db-config.mjs.
process.env.CANA_PRESERVE_SQLITE_FILE_BYTES = '1';

// Bind to loopback: Passenger proxies external traffic to this process.
if (!process.env.HOSTNAME) {
  process.env.HOSTNAME = '127.0.0.1';
}

// CageFS hides /etc/os-release from CloudLinux shared accounts, so Prisma's
// platform detector guesses "debian" while the host is really RHEL-family
// (probe 2026-07-23: OpenSSL 1.1.1k FIPS). Point Prisma directly at the
// bundled engine unless the operator overrides it.
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const path = require('node:path');
  const fs = require('node:fs');
  const bundledEngine = path.join(
    __dirname,
    'node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node',
  );
  if (fs.existsSync(bundledEngine)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = bundledEngine;
  }
}

// Fail loudly and early if the operator forgot the database location —
// a directory site that silently starts without its database is worse
// than one that refuses to start.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. In cPanel > Setup Node.js App, add ' +
      'DATABASE_URL=file:/home/<cpanel-user>/orderweeddc-data/prod.db ' +
      'and restart.',
  );
}

require('./server.js');
