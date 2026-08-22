import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBrowserProcessCustodian, readLinuxProcessSnapshot } from './process-custody.mjs';

function fixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cana-process-custody-${label}-`));
  const procRoot = path.join(root, 'proc');
  const userDataDir = path.join(root, 'profile');
  fs.mkdirSync(procRoot);
  fs.mkdirSync(userDataDir);
  return { root, procRoot, userDataDir, runToken: `token-${label}` };
}

function writeRow(procRoot, {
  pid, parentPid, processGroup, startTime, environment = [], argv = [], partial = false, state = 'S',
}) {
  const directory = path.join(procRoot, String(pid));
  fs.mkdirSync(directory, { recursive: true });
  const fields = [state, parentPid, processGroup, ...Array(16).fill(0), startTime];
  fs.writeFileSync(path.join(directory, 'stat'), `${pid} (fixture) ${fields.join(' ')}`);
  if (!partial) {
    fs.writeFileSync(path.join(directory, 'environ'), `${environment.join('\0')}\0`);
    fs.writeFileSync(path.join(directory, 'cmdline'), `${argv.join('\0')}\0`);
  }
}

test('exited zombie identity is not an incomplete proc snapshot', () => {
  const f = fixture('zombie');
  try {
    writeRow(f.procRoot, {
      pid: 100, parentPid: 1, processGroup: 100, startTime: '1000', partial: true, state: 'Z',
    });
    const snapshot = readLinuxProcessSnapshot(f.procRoot, { effectiveUid: process.geteuid?.() ?? null });
    assert.equal(snapshot.complete, true);
    assert.deepEqual(snapshot.errors, []);
    assert.deepEqual(snapshot.rows[0].environment, []);
    assert.deepEqual(snapshot.rows[0].argv, []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

function removeRow(procRoot, pid) {
  fs.rmSync(path.join(procRoot, String(pid)), { recursive: true, force: true });
}

function controller(procRoot, signals) {
  function currentStart(pid) {
    try {
      const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    } catch {
      return null;
    }
  }
  return {
    signal({ pid, startTime, signal }) {
      const current = currentStart(pid);
      if (current === null) return { status: 'EXITED_EXACT' };
      if (current !== startTime) return { status: 'IDENTITY_REPLACED' };
      signals.push({ pid, startTime, signal });
      removeRow(procRoot, pid);
      return { status: 'SIGNALLED_EXACT' };
    },
    status({ pid, startTime }) {
      const current = currentStart(pid);
      if (current === null) return { status: 'EXITED_EXACT' };
      return { status: current === startTime ? 'LIVE_EXACT' : 'IDENTITY_REPLACED' };
    },
  };
}

test('forged marker never grants signal authority', async () => {
  const f = fixture('forged');
  const signals = [];
  try {
    writeRow(f.procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    writeRow(f.procRoot, {
      pid: 200,
      parentPid: 1,
      processGroup: 200,
      startTime: '2000',
      environment: [`CANA_VISUAL_RUN_TOKEN=${f.runToken}`],
    });
    const custody = createBrowserProcessCustodian({
      rootPid: 100, runToken: f.runToken, userDataDir: f.userDataDir,
      platform: 'linux', procRoot: f.procRoot, processController: controller(f.procRoot, signals), samplerMs: 0, graceMs: 0,
    });
    const receipt = await custody.cleanup();
    assert.equal(signals.some((entry) => entry.pid === 200), false);
    assert.equal(fs.existsSync(path.join(f.procRoot, '200')), true);
    assert.equal(receipt.failureClass, 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('recycled process group never grants authority', async () => {
  const f = fixture('recycled');
  const signals = [];
  try {
    writeRow(f.procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    const custody = createBrowserProcessCustodian({
      rootPid: 100, runToken: f.runToken, userDataDir: f.userDataDir,
      platform: 'linux', procRoot: f.procRoot, processController: controller(f.procRoot, signals), samplerMs: 0, graceMs: 0,
    });
    removeRow(f.procRoot, 100);
    writeRow(f.procRoot, { pid: 200, parentPid: 1, processGroup: 100, startTime: '2000' });
    const receipt = await custody.cleanup();
    assert.deepEqual(signals, []);
    assert.equal(receipt.failureClass, null);
    assert.equal(receipt.ownedBrowserProcessCountAfter, 0);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('partial proc visibility refuses false zero', async () => {
  const f = fixture('partial');
  const signals = [];
  try {
    writeRow(f.procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    writeRow(f.procRoot, { pid: 300, parentPid: 1, processGroup: 300, startTime: '3000', partial: true });
    const custody = createBrowserProcessCustodian({
      rootPid: 100, runToken: f.runToken, userDataDir: f.userDataDir,
      platform: 'linux', procRoot: f.procRoot, processController: controller(f.procRoot, signals), samplerMs: 0, graceMs: 0,
    });
    const receipt = await custody.cleanup();
    assert.equal(receipt.failureClass, 'CHROMIUM_CLEANUP_PROOF_UNAVAILABLE');
    assert.equal(receipt.proofAvailable, false);
    assert.equal(fs.existsSync(path.join(f.procRoot, '300')), true);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('escaped descendant with an observed stable identity is terminated exactly', async () => {
  const f = fixture('escaped');
  const signals = [];
  try {
    writeRow(f.procRoot, { pid: 100, parentPid: 1, processGroup: 100, startTime: '1000' });
    writeRow(f.procRoot, { pid: 101, parentPid: 100, processGroup: 101, startTime: '1010' });
    const custody = createBrowserProcessCustodian({
      rootPid: 100, runToken: f.runToken, userDataDir: f.userDataDir,
      platform: 'linux', procRoot: f.procRoot, processController: controller(f.procRoot, signals), samplerMs: 0, graceMs: 0,
    });
    assert.equal(custody.enumerateOwnedProcesses().some((row) => row.pid === 101), true);
    writeRow(f.procRoot, { pid: 101, parentPid: 1, processGroup: 101, startTime: '1010' });
    const receipt = await custody.cleanup();
    assert.deepEqual(signals.map(({ pid, startTime }) => ({ pid, startTime })), [
      { pid: 101, startTime: '1010' },
      { pid: 100, startTime: '1000' },
    ]);
    assert.equal(receipt.failureClass, null);
    assert.equal(receipt.ownedBrowserProcessCountAfter, 0);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
