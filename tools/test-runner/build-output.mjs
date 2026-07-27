import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIAGNOSTICS = Object.freeze([
  Object.freeze({
    code: 'NEXT_COMPILED_WITH_WARNINGS',
    pattern: /compiled with warnings/i,
  }),
  Object.freeze({
    code: 'NEXT_ATTEMPTED_IMPORT_ERROR',
    pattern: /attempted import error:/i,
  }),
  Object.freeze({
    code: 'NEXT_MODULE_NOT_FOUND',
    pattern: /module not found:/i,
  }),
]);

export function buildOutputDiagnostics(output) {
  if (typeof output !== 'string') {
    throw new TypeError('build output must be a string');
  }
  return DIAGNOSTICS
    .filter(({ pattern }) => pattern.test(output))
    .map(({ code }) => code);
}

export function assertBuildOutputClean(output) {
  const diagnostics = buildOutputDiagnostics(output);
  if (diagnostics.length) {
    throw new Error(`Next build emitted release-blocking diagnostics: ${diagnostics.join(', ')}`);
  }
  return diagnostics;
}

function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    throw new Error('usage: node build-output.mjs <build-log>');
  }
  const output = fs.readFileSync(path.resolve(file), 'utf8');
  assertBuildOutputClean(output);
  process.stdout.write('CANA_BUILD_DIAGNOSTICS_PASS warnings=0\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
