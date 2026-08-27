import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const currentTestFile = fileURLToPath(import.meta.url);
const webRoot = path.resolve(testDirectory, '..');
const repositoryRoot = path.resolve(webRoot, '../..');

test('the release workspace names only executable, verified packages', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  assert.deepEqual(rootPackage.workspaces, [
    'apps/web',
    'packages/ad-creative',
    'packages/ai',
  ]);
  const webPackage = JSON.parse(
    fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'),
  );
  assert.equal(webPackage.devDependencies.postcss, '8.5.19');
  assert.equal(webPackage.dependencies.next, '15.5.24');
  assert.equal(
    webPackage.devDependencies['eslint-config-next'],
    '15.5.24',
  );
  const packageDirectories = fs
    .readdirSync(path.join(repositoryRoot, 'packages'), {
      withFileTypes: true,
    })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // paid-governance is a Python package (unittest-verified), so it lives in
  // packages/ but is intentionally absent from the npm workspaces list above.
  // governor-kernel is conserved Federation work (a Python kernel with its own
  // attack-court/standalone/sitemind test suites), added by the sovereign-sibling
  // merge; like paid-governance it lives in packages/ but is intentionally absent
  // from the npm workspaces list above.
  assert.deepEqual(packageDirectories, [
    'ad-creative',
    'ai',
    'governor-kernel',
    'paid-governance',
  ]);
});

test('shadow application and data-model entry points stay retired', () => {
  for (const retiredPath of [
    'src',
    'packages/data',
    'receipt-phase1.md',
    'apps/web/package-lock.json',
    'loop_report.md',
    'loop_state.json',
    'state-ledger.json',
  ]) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, retiredPath)),
      false,
      `${retiredPath} must not reappear beside the canonical application.`,
    );
  }

  const canonicalSchema = fs.readFileSync(
    path.join(webRoot, 'prisma/schema.prisma'),
    'utf8',
  );
  assert.match(canonicalSchema, /model PublicSubmissionEvent/);
  assert.match(canonicalSchema, /model LicenseEvidence/);
});

test('tracked source contains no retired predictable bootstrap passwords', () => {
  const forbidden = [
    ['admin', 'secret', 'password'].join(''),
    ['retailer', 'secret', 'password'].join(''),
    ['customer', 'secret'].join(''),
  ];
  const sourceRoots = [
    path.join(repositoryRoot, 'apps'),
    path.join(repositoryRoot, 'packages'),
  ];
  const matches = [];

  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.next'].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
        continue;
      }
      if (
        fullPath === currentTestFile ||
        !/\.(?:js|jsx|json|md|mjs|ts|tsx|yml|yaml)$/i.test(entry.name)
      ) {
        continue;
      }
      const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
      if (forbidden.some((value) => content.includes(value))) {
        matches.push(path.relative(repositoryRoot, fullPath));
      }
    }
  }

  for (const sourceRoot of sourceRoots) scan(sourceRoot);
  assert.deepEqual(matches, []);
});

test('the Tailwind 4 release entrypoint compiles utilities and dynamic brand tokens', () => {
  const globalStyles = fs.readFileSync(
    path.join(webRoot, 'src/app/globals.css'),
    'utf8',
  );
  const postcssConfig = fs.readFileSync(
    path.join(webRoot, 'postcss.config.mjs'),
    'utf8',
  );

  assert.match(globalStyles, /^@import "tailwindcss";/);
  assert.match(globalStyles, /@theme inline\s*\{/);
  for (const token of [
    'primary',
    'secondary',
    'background',
    'surface',
    'border',
    'text',
  ]) {
    assert.match(
      globalStyles,
      new RegExp(
        `--color-brand-${token}:\\s*var\\(--brand-${token}\\)`,
      ),
    );
  }
  assert.match(postcssConfig, /'@tailwindcss\/postcss':\s*\{\}/);
  assert.equal(
    fs.existsSync(path.join(webRoot, 'tailwind.config.js')),
    false,
    'The ignored Tailwind 3 configuration must not return.',
  );
});
