import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import { prepareLinuxCustodyHelper } from './linux-custody.mjs';

const linux = process.platform === 'linux';

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

test('native helper writes beneath retained binding and refuses a swapped root', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-test-'));
  const output = path.join(root, 'output');
  const protectedRoot = path.join(root, 'protected');
  fs.mkdirSync(output);
  fs.mkdirSync(protectedRoot);
  const binding = fs.statSync(output, { bigint: true });
  const helper = prepareLinuxCustodyHelper();
  try {
    helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'route/light/430.png',
      bytes: Buffer.from('png'),
    });
    assert.equal(fs.readFileSync(path.join(output, 'route/light/430.png'), 'utf8'), 'png');
    fs.renameSync(output, `${output}.held`);
    fs.symlinkSync(protectedRoot, output, 'dir');
    assert.throws(() => helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'sentinel',
      bytes: Buffer.from('blocked'),
    }), /OUTPUT_WRITE_REFUSED/);
    assert.equal(fs.existsSync(path.join(protectedRoot, 'sentinel')), false);
  } finally {
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native helper signals only the expected pid start time', { skip: !linux }, async () => {
  const helper = prepareLinuxCustodyHelper();
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], {
    stdio: 'ignore',
  });
  try {
    const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    const startTime = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    const replaced = helper.signal({ pid: child.pid, startTime: `${startTime}1`, signal: 'SIGTERM' });
    assert.equal(replaced.status, 'IDENTITY_REPLACED');
    assert.equal(child.exitCode, null);
    const signalled = helper.signal({ pid: child.pid, startTime, signal: 'SIGTERM' });
    assert.equal(signalled.status, 'SIGNALLED_EXACT');
    await waitForExit(child);
    assert.equal(child.signalCode === 'SIGTERM' || child.exitCode !== null, true);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    helper.close();
  }
});

test('native helper launches from the exact retained workspace identity', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-launch-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const binding = fs.statSync(workspace, { bigint: true });
  const helper = prepareLinuxCustodyHelper();
  try {
    const spec = helper.launchSpec({
      rootPath: workspace,
      device: binding.dev,
      inode: binding.ino,
      executable: '/bin/pwd',
      argv: [],
    });
    const result = fs.realpathSync(workspace);
    assert.equal(result, workspace);
    const launched = spawnSync(spec.command, spec.argv, { encoding: 'utf8' });
    assert.equal(launched.status, 0);
    assert.equal(launched.stdout.trim(), workspace);
  } finally {
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native helper creates an exclusive private directory beneath the retained parent', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-mkdir-'));
  const parent = path.join(root, 'parent');
  const protectedRoot = path.join(root, 'protected');
  fs.mkdirSync(parent, { mode: 0o700 });
  fs.mkdirSync(protectedRoot, { mode: 0o700 });
  const binding = fs.statSync(parent, { bigint: true });
  const helper = prepareLinuxCustodyHelper();
  try {
    const created = helper.createDirectory({
      parentPath: parent,
      device: binding.dev,
      inode: binding.ino,
      name: 'court',
    });
    assert.equal(created.status, 'CREATED');
    assert.equal(fs.statSync(path.join(parent, 'court')).mode & 0o777, 0o700);

    fs.renameSync(parent, `${parent}.held`);
    fs.symlinkSync(protectedRoot, parent, 'dir');
    assert.throws(() => helper.createDirectory({
      parentPath: parent,
      device: binding.dev,
      inode: binding.ino,
      name: 'must-not-enter-source',
    }), /DIRECTORY_CREATE_REFUSED/);
    assert.equal(fs.existsSync(path.join(protectedRoot, 'must-not-enter-source')), false);
  } finally {
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native launch supervisor drains an adopted detached descendant before shutdown', { skip: !linux }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-drain-'));
  const workspace = path.join(root, 'workspace');
  const fixture = path.join(workspace, 'spawn-detached.cjs');
  const pidFile = path.join(workspace, 'adopted.pid');
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.writeFileSync(fixture, [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
    "fs.writeFileSync(process.argv[2], String(child.pid));",
    'child.unref();',
  ].join('\n'));
  const binding = fs.statSync(workspace, { bigint: true });
  const helper = prepareLinuxCustodyHelper();
  const spec = helper.launchSpec({
    rootPath: workspace,
    device: binding.dev,
    inode: binding.ino,
    executable: process.execPath,
    argv: [fixture, pidFile],
  });
  const supervisor = spawn(spec.command, spec.argv, { stdio: 'ignore' });
  let adoptedPid = null;
  try {
    assert.equal(await waitUntil(() => fs.existsSync(pidFile)), true, 'fixture must publish the adopted child pid');
    adoptedPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(Number.isInteger(adoptedPid) && adoptedPid > 1, true);
    assert.equal(processExists(adoptedPid), true, 'detached child must be live before supervisor shutdown');

    supervisor.kill('SIGTERM');
    assert.equal(await Promise.race([
      waitForExit(supervisor).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]), true, 'supervisor must settle after shutdown');
    assert.equal(await waitUntil(() => !processExists(adoptedPid)), true, 'supervisor must not orphan its adopted child');
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL');
    if (adoptedPid && processExists(adoptedPid)) process.kill(adoptedPid, 'SIGKILL');
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
