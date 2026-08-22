import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBrowserProcessCustodian,
  prepareHarnessDirectories,
} from './screenshot-harness.mjs';

function makeRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cana-harness-custody-${label}-`));
}

function writeProcRow(procRoot, {
  pid,
  parentPid,
  processGroup,
  startTime,
  environment = [],
  argv = [],
  omitEnvironment = false,
  omitArgv = false,
}) {
  const directory = path.join(procRoot, String(pid));
  fs.mkdirSync(directory, { recursive: true });
  const statFields = ['S', parentPid, processGroup, ...Array(16).fill(0), startTime];
  fs.writeFileSync(path.join(directory, 'stat'), `${pid} (fixture) ${statFields.join(' ')}`);
  if (!omitEnvironment) fs.writeFileSync(path.join(directory, 'environ'), `${environment.join('\0')}\0`);
  if (!omitArgv) fs.writeFileSync(path.join(directory, 'cmdline'), `${argv.join('\0')}\0`);
}

function removeProcRow(procRoot, pid) {
  fs.rmSync(path.join(procRoot, String(pid)), { recursive: true, force: true });
}

function makeCustodianFixture(label) {
  const root = makeRoot(label);
  const procRoot = path.join(root, 'proc');
  const userDataDir = path.join(root, 'profile');
  fs.mkdirSync(procRoot);
  fs.mkdirSync(userDataDir);
  const runToken = `token-${label}`;
  return { root, procRoot, userDataDir, runToken };
}

function outputWriter() {
  return {
    createDirectory({ parentPath, device, inode, name }) {
      const binding = fs.statSync(parentPath, { bigint: true });
      if (binding.dev !== device || binding.ino !== inode) throw new Error('DIRECTORY_CREATE_REFUSED');
      fs.mkdirSync(path.join(parentPath, name), { mode: 0o700 });
      return { status: 'CREATED' };
    },
    write({ rootPath, relativePath, bytes }) {
      const target = path.join(rootPath, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx' });
      return { status: 'WROTE', bytes: Buffer.byteLength(bytes) };
    },
  };
}

function exactController(procRoot, signals) {
  function startTime(pid) {
    try {
      const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    } catch {
      return null;
    }
  }
  return {
    signal({ pid, startTime: expected, signal }) {
      const current = startTime(pid);
      if (current === null) return { status: 'EXITED_EXACT' };
      if (current !== expected) return { status: 'IDENTITY_REPLACED' };
      signals.push({ pid, startTime: expected, signal });
      removeProcRow(procRoot, pid);
      return { status: 'SIGNALLED_EXACT' };
    },
    status({ pid, startTime: expected }) {
      const current = startTime(pid);
      if (current === null) return { status: 'EXITED_EXACT' };
      return { status: current === expected ? 'LIVE_EXACT' : 'IDENTITY_REPLACED' };
    },
  };
}

test('output custody survives an ancestor swap without writing into source', () => {
  const root = makeRoot('output');
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'outside', 'court');
  const tempRoot = path.join(root, 'temp');
  const sentinel = path.join(sourceRoot, 'TOCTOU_SENTINEL');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
  fs.mkdirSync(tempRoot);
  let prepared = null;

  try {
    prepared = prepareHarnessDirectories(outputRoot, { sourceRoot, tempRoot, outputWriter: outputWriter() });
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.symlinkSync(sourceRoot, outputRoot, 'dir');
    assert.throws(
      () => prepared.outputCustody.writeArtifact('TOCTOU_SENTINEL', 'must-not-enter-source'),
      /OUTPUT_BINDING_LOST/,
    );
    assert.equal(fs.existsSync(sentinel), false, 'descriptor-bound output custody must not follow a swapped output path');
  } finally {
    try { prepared?.outputCustody.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forged marker never grants authority to signal an unrelated process', async () => {
  const fixture = makeCustodianFixture('forged');
  const { root, procRoot, userDataDir, runToken } = fixture;
  const tokenMarker = `CANA_VISUAL_RUN_TOKEN=${runToken}`;
  const signals = [];
  try {
    writeProcRow(procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    writeProcRow(procRoot, {
      pid: 200,
      parentPid: 1,
      processGroup: 200,
      startTime: '2000',
      environment: [tokenMarker],
    });
    const custodian = createBrowserProcessCustodian({
      rootPid: 100,
      runToken,
      userDataDir,
      platform: 'linux',
      procRoot,
      processController: exactController(procRoot, signals),
      samplerMs: 0,
      graceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    });
    const receipt = await custodian.cleanup();
    assert.equal(signals.some((entry) => entry.pid === 200), false);
    assert.equal(fs.existsSync(path.join(procRoot, '200')), true);
    assert.equal(receipt.failureClass, 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recycled process group never grants authority after the original root exits', async () => {
  const fixture = makeCustodianFixture('recycled');
  const { root, procRoot, userDataDir, runToken } = fixture;
  const signals = [];
  try {
    writeProcRow(procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    const custodian = createBrowserProcessCustodian({
      rootPid: 100,
      runToken,
      userDataDir,
      platform: 'linux',
      procRoot,
      processController: exactController(procRoot, signals),
      samplerMs: 0,
      graceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    });
    removeProcRow(procRoot, 100);
    writeProcRow(procRoot, { pid: 200, parentPid: 1, processGroup: 100, startTime: '2000' });
    const receipt = await custodian.cleanup();
    assert.deepEqual(signals, []);
    assert.equal(fs.existsSync(path.join(procRoot, '200')), true);
    assert.equal(receipt.ownedBrowserProcessCountAfter, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('partial /proc visibility refuses a false zero-residual proof', async () => {
  const fixture = makeCustodianFixture('partial');
  const { root, procRoot, userDataDir, runToken } = fixture;
  try {
    writeProcRow(procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    const custodian = createBrowserProcessCustodian({
      rootPid: 100,
      runToken,
      userDataDir,
      platform: 'linux',
      procRoot,
      processController: exactController(procRoot, []),
      samplerMs: 0,
      graceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    });
    writeProcRow(procRoot, {
      pid: 300,
      parentPid: 1,
      processGroup: 300,
      startTime: '3000',
      omitEnvironment: true,
      omitArgv: true,
    });
    const receipt = await custodian.cleanup();
    assert.equal(receipt.failureClass, 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE');
    assert.equal(receipt.proofAvailable, false);
    assert.equal(fs.existsSync(path.join(procRoot, '300')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('escaped descendant with an observed stable identity is terminated exactly', async () => {
  const fixture = makeCustodianFixture('escaped');
  const { root, procRoot, userDataDir, runToken } = fixture;
  const signals = [];
  try {
    writeProcRow(procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    writeProcRow(procRoot, { pid: 101, parentPid: 100, processGroup: 101, startTime: '1010' });
    const custodian = createBrowserProcessCustodian({
      rootPid: 100,
      runToken,
      userDataDir,
      platform: 'linux',
      procRoot,
      processController: exactController(procRoot, signals),
      samplerMs: 0,
      graceMs: 1,
      pollMs: 1,
      sleep: async () => {},
    });
    assert.equal(custodian.enumerateOwnedProcesses().some((row) => row.pid === 101), true);
    writeProcRow(procRoot, {
      pid: 101,
      parentPid: 1,
      processGroup: 101,
      startTime: '1010',
    });
    const receipt = await custodian.cleanup();
    assert.equal(signals.some((entry) => entry.pid === 101), true);
    assert.equal(receipt.failureClass, null);
    assert.equal(receipt.ownedBrowserProcessCountAfter, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
