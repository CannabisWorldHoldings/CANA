import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(webRoot, '../..');

const supplied = process.env.CANA_RELEASE_SHA;
if (!/^[0-9a-f]{40}$/.test(supplied ?? '')) {
  throw new Error('CLOUDFLARE_BUILD_RELEASE_SHA_REQUIRED');
}

const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

if (supplied !== checkedOut) {
  throw new Error('CLOUDFLARE_BUILD_RELEASE_SHA_SOURCE_MISMATCH');
}

process.stdout.write(`CLOUDFLARE_BUILD_RELEASE_SHA_BOUND ${checkedOut}\n`);
