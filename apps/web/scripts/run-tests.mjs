import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testsDir = path.resolve(__dirname, '../tests');

function checkLiveServerPort3000() {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 3000, path: '/api/health', method: 'GET', timeout: 500 }, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function run() {
  const isLiveServerAvailable = await checkLiveServerPort3000();

  const allTestFiles = fs
    .readdirSync(testsDir)
    .filter((file) => file.endsWith('.test.mjs'))
    .map((file) => path.join(testsDir, file));

  const httpE2eTests = new Set([
    'api-v1-attribution.test.mjs',
    'api-v1-contract.test.mjs',
    'api-v1-deals.test.mjs',
    'api-v1-neighborhoods.test.mjs',
    'api-v1-products.test.mjs',
    'api-v1-retailers.test.mjs',
    'release-gate.test.mjs',
  ]);

  const testFilesToRun = isLiveServerAvailable || process.env.RUN_E2E_TESTS === 'true'
    ? allTestFiles
    : allTestFiles.filter((filePath) => !httpE2eTests.has(path.basename(filePath)));

  if (!isLiveServerAvailable && process.env.RUN_E2E_TESTS !== 'true') {
    console.log(`[INFO] Port 3000 server not running. Running ${testFilesToRun.length} unit/integration test files (excluding 7 live-server e2e contract test suites).`);
  } else {
    console.log(`[INFO] Port 3000 server active. Executing all ${testFilesToRun.length} test files.`);
  }

  const args = ['--test', ...testFilesToRun];
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
