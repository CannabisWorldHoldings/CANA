#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:?verification profile required}"
EXPECTED_SHA="${2:?expected commit required}"
ROOT=/workspace
WEB="$ROOT/apps/web"
DB="$WEB/prisma/cana-verify.db"
SERVER_PID=""

cleanup() {
  local prior=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "CANA_CLEANUP_FAILED server pid $SERVER_PID is still alive" >&2
    exit 70
  fi
  echo "CANA_CLEANUP_PASS owned server terminated; container namespace owns port 3000"
  exit "$prior"
}
trap cleanup EXIT INT TERM

node -e '
  const expected = process.argv[1];
  if (!/^[0-9a-f]{40}$/.test(expected)) throw new Error("expected SHA must be 40 lowercase hex");
  console.log(JSON.stringify({
    event: "runtime",
    version: process.version,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    expectedSha: expected
  }));
' "$EXPECTED_SHA"

npm ci --no-audit --no-fund
(
  cd "$WEB"
  npx --no-install prisma generate
)

build_web() {
  local started
  started=$(date +%s)
  rm -rf "$WEB/.next"
  (
    cd "$WEB"
    CANA_RELEASE_SHA="$EXPECTED_SHA" npm run build
  )
  test -s "$WEB/.next/BUILD_ID"
  local built
  built=$(stat -c %Y "$WEB/.next/BUILD_ID")
  test "$built" -ge "$started"
  echo "CANA_STALE_BUILD_CHECK_PASS build-id=$(cat "$WEB/.next/BUILD_ID")"
}

prepare_database() {
  : > "$DB"
  (
    cd "$WEB"
    DATABASE_URL="file:$DB" npx --no-install prisma migrate deploy --schema prisma/schema.prisma
    DATABASE_URL="file:$DB" NODE_ENV=development node prisma/seed.mjs
  )
}

write_release_identity() {
  node -e '
    const fs = require("node:fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      gitSha: process.argv[2],
      builtAt: new Date().toISOString(),
      environment: "verification-container"
    }));
  ' "$WEB/release.json" "$EXPECTED_SHA"
}

probe_release() {
  node - <<'NODE'
const http = require('node:http');
const expected = process.env.CANA_EXPECTED_SHA;
function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3000,
      path: pathname,
      method: 'GET',
      headers: { Host: 'orderweeddc.localhost' },
      timeout: 3000,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}
(async () => {
  let health;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      health = await request('/api/health');
      if (health.status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!health || health.status !== 200 || !health.body.includes('"status":"HEALTHY"')) {
    throw new Error(`health never became ready: ${health?.status ?? 'no response'} ${health?.body ?? ''}`);
  }
  const release = await request('/api/release');
  const parsed = JSON.parse(release.body);
  if (
    release.status !== 200 ||
    parsed.status !== 'RELEASE_SHA_PRESENT' ||
    parsed.gitSha !== expected ||
    !String(release.headers['cache-control'] ?? '').includes('no-store')
  ) {
    throw new Error(`release identity mismatch: ${release.status} ${release.body}`);
  }
  console.log(JSON.stringify({
    event: 'server-identity',
    health: 'HEALTHY',
    status: parsed.status,
    gitSha: parsed.gitSha,
    cacheControl: release.headers['cache-control'],
  }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
NODE
}

start_server() {
  (
    cd "$WEB"
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    DATABASE_URL="file:$DB" \
    NODE_ENV=production \
    CANA_EXPECTED_SHA="$EXPECTED_SHA" \
    npm start -- -H 127.0.0.1 -p 3000
  ) > /tmp/cana-next.log 2>&1 &
  SERVER_PID=$!
  export CANA_EXPECTED_SHA="$EXPECTED_SHA"
  probe_release
}

case "$PROFILE" in
  focused|clean-clone)
    build_web
    (
      cd "$WEB"
      node --test \
        tests/release-identity.test.mjs \
        tests/release-sha.test.mjs \
        tests/column-width-cutover-court.test.mjs \
        tests/evidence-spill.test.mjs \
        tests/migration-court.test.mjs
    )
    (
      cd "$ROOT"
      node --test \
        deploy/namecheap/artifact-exclusions.test.mjs \
        deploy/namecheap/release-preflight.test.mjs
    )
    ;;
  release)
    build_web
    prepare_database
    write_release_identity
    start_server
    (
      cd "$WEB"
      DATABASE_URL="file:$DB" node --test \
        tests/release-identity.test.mjs \
        tests/release-sha.test.mjs
    )
    ;;
  full)
    build_web
    prepare_database
    write_release_identity
    start_server
    (
      cd "$WEB"
      DATABASE_URL="file:$DB" node --test --test-concurrency=1 tests/*.test.mjs
    )
    (
      cd "$ROOT"
      npm test -w packages/ad-creative
      npm test -w packages/ai
      node --test deploy/namecheap/*.test.mjs
    )
    ;;
  *)
    echo "unknown container profile: $PROFILE" >&2
    exit 2
    ;;
esac

echo "CANA_CONTAINER_VERIFY_PASS profile=$PROFILE expected=$EXPECTED_SHA"
