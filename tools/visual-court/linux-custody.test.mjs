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
    assert.throws(() => helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'route/light/430.png',
      bytes: Buffer.from('replacement'),
    }), /OUTPUT_WRITE_REFUSED/);
    assert.equal(fs.readFileSync(path.join(output, 'route/light/430.png'), 'utf8'), 'png',
      'exclusive refusal must preserve the existing artifact');
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

test('legacy helper and compiler environment paths never enter the inline custody runtime', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-legacy-env-'));
  const attacker = path.join(root, 'attacker');
  const output = path.join(root, 'output');
  const sentinel = path.join(root, 'attacker-ran');
  fs.mkdirSync(output, { mode: 0o700 });
  fs.writeFileSync(attacker, `#!/bin/sh\nprintf attacked >> ${JSON.stringify(sentinel)}\nexit 0\n`, { mode: 0o700 });
  const previous = {
    CC: process.env.CC,
    CANA_LINUX_CUSTODY_HELPER: process.env.CANA_LINUX_CUSTODY_HELPER,
    CANA_LINUX_CUSTODY_SOURCE_SHA256: process.env.CANA_LINUX_CUSTODY_SOURCE_SHA256,
    CANA_LINUX_CUSTODY_BINARY_SHA256: process.env.CANA_LINUX_CUSTODY_BINARY_SHA256,
  };
  process.env.CC = attacker;
  process.env.CANA_LINUX_CUSTODY_HELPER = attacker;
  process.env.CANA_LINUX_CUSTODY_SOURCE_SHA256 = '0'.repeat(64);
  process.env.CANA_LINUX_CUSTODY_BINARY_SHA256 = 'f'.repeat(64);
  let helper;
  try {
    helper = prepareLinuxCustodyHelper();
    const binding = fs.statSync(output, { bigint: true });
    helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'bound.txt',
      bytes: Buffer.from('png'),
    });
    const launch = helper.launchSpec({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      executable: '/bin/pwd',
      argv: [],
    });
    const launched = spawnSync(launch.command, launch.argv, {
      encoding: 'utf8',
      env: launch.env,
      stdio: launch.stdio,
    });
    assert.equal(fs.readFileSync(path.join(output, 'bound.txt'), 'utf8'), 'png');
    assert.equal(launched.status, 0);
    assert.equal(launched.stdout.trim(), output);
    assert.equal(fs.existsSync(sentinel), false, 'legacy compiler/helper paths must never execute');
  } finally {
    helper?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inline custody invokes only isolated Python with three standard streams and a fixed environment', { skip: !linux }, () => {
  const calls = [];
  const run = (command, argv, options) => {
    calls.push({ command, argv, options });
    return spawnSync(command, argv, options);
  };
  const helper = prepareLinuxCustodyHelper({ run });
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, fs.realpathSync('/usr/bin/python3'));
    assert.deepEqual(calls[0].argv.slice(0, 4), ['-I', '-S', '-E', '-c']);
    assert.equal(calls[0].argv.at(-1), 'probe');
    assert.deepEqual(Object.keys(calls[0].options.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'TZ']);
    assert.equal(Object.isFrozen(calls[0].options.env), true, 'the fixed custody environment is immutable');
    assert.equal(calls[0].options.stdio.length, 3, 'no inherited helper or compiler descriptor may exist');
    assert.equal(helper.compiler, null);
    assert.deepEqual(helper.compileArgv, []);
    assert.match(helper.sourceSha256, /^[0-9a-f]{64}$/);
  } finally {
    helper.close();
  }
});

test('ambient dynamic-loader injection never reaches interpreter, helper operation or launched process', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-loader-env-'));
  const library = path.join(root, 'attacker.so');
  const sentinel = path.join(root, 'attacker-ran');
  const output = path.join(root, 'output');
  fs.mkdirSync(output, { mode: 0o700 });
  const compiled = spawnSync('/usr/bin/cc', ['-shared', '-fPIC', '-x', 'c', '-o', library, '-'], {
    encoding: 'utf8',
    input: [
      '#include <fcntl.h>',
      '#include <unistd.h>',
      '__attribute__((constructor)) static void attack(void) {',
      `  int fd = open(${JSON.stringify(sentinel)}, O_CREAT | O_WRONLY | O_APPEND, 0600);`,
      '  if (fd >= 0) { (void)write(fd, "attacked", 8); (void)close(fd); }',
      '}',
    ].join('\n'),
  });
  assert.equal(compiled.status, 0, compiled.stderr);
  const previousPreload = process.env.LD_PRELOAD;
  const previousLibraryPath = process.env.LD_LIBRARY_PATH;
  process.env.LD_PRELOAD = library;
  process.env.LD_LIBRARY_PATH = root;
  let helper;
  try {
    helper = prepareLinuxCustodyHelper();
    const binding = fs.statSync(output, { bigint: true });
    helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'sealed.txt',
      bytes: Buffer.from('safe'),
    });
    const launch = helper.launchSpec({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      executable: '/bin/pwd',
      argv: [],
    });
    assert.equal(launch.env.LD_PRELOAD, undefined);
    assert.equal(launch.env.LD_LIBRARY_PATH, undefined);
    const launched = spawnSync(launch.command, launch.argv, {
      encoding: 'utf8',
      env: launch.env,
      stdio: launch.stdio,
    });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stdout.trim(), output);
    assert.equal(fs.readFileSync(path.join(output, 'sealed.txt'), 'utf8'), 'safe');
    assert.equal(fs.existsSync(sentinel), false, 'ambient loader injection must never execute');
  } finally {
    helper?.close();
    if (previousPreload === undefined) delete process.env.LD_PRELOAD;
    else process.env.LD_PRELOAD = previousPreload;
    if (previousLibraryPath === undefined) delete process.env.LD_LIBRARY_PATH;
    else process.env.LD_LIBRARY_PATH = previousLibraryPath;
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
    const launched = spawnSync(spec.command, spec.argv, { encoding: 'utf8', env: spec.env, stdio: spec.stdio });
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
    assert.throws(() => helper.createDirectory({
      parentPath: parent,
      device: binding.dev,
      inode: binding.ino,
      name: 'court',
    }), /DIRECTORY_CREATE_REFUSED/);
    assert.equal(fs.statSync(path.join(parent, 'court')).isDirectory(), true,
      'exclusive refusal must preserve the existing directory');

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
  const supervisor = spawn(spec.command, spec.argv, { env: spec.env, stdio: spec.stdio });
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
