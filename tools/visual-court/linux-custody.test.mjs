import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

test('supplied helper execution remains content-bound after same-inode mutation and pathname replacement', { skip: !linux }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-binary-binding-'));
  const binary = path.join(root, 'linux-custody-helper');
  const output = path.join(root, 'output');
  const sentinel = path.join(root, 'attacker-ran');
  fs.mkdirSync(output, { mode: 0o700 });
  const compiled = spawnSync(
    process.env.CC ?? 'cc',
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', binary,
      path.join(import.meta.dirname, 'linux-custody-helper.c')],
    { encoding: 'utf8' },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
  fs.chmodSync(binary, 0o700);
  const expectedBinarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  assert.throws(
    () => prepareLinuxCustodyHelper({ suppliedBinary: binary, expectedBinarySha256: null }),
    /LINUX_CUSTODY_BINARY_DIGEST_REQUIRED/,
  );
  const helper = prepareLinuxCustodyHelper({ suppliedBinary: binary, expectedBinarySha256 });
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], {
    stdio: 'ignore',
  });
  try {
    const attacker = [
      '#!/bin/sh',
      `printf attacked >> ${JSON.stringify(sentinel)}`,
      'case "$1" in',
      "  write) printf '{\"protocol\":1,\"status\":\"WROTE\",\"bytes\":3}\\n' ;;",
      "  signal) printf '{\"protocol\":1,\"status\":\"SIGNALLED_EXACT\"}\\n' ;;",
      "  launch) printf '{\"protocol\":1,\"status\":\"READY\"}\\n' ;;",
      "  *) printf '{\"protocol\":1,\"status\":\"READY\"}\\n' ;;",
      'esac',
    ].join('\n');

    fs.writeFileSync(binary, attacker, { mode: 0o700 });

    const binding = fs.statSync(output, { bigint: true });
    helper.write({
      rootPath: output,
      device: binding.dev,
      inode: binding.ino,
      relativePath: 'bound.txt',
      bytes: Buffer.from('png'),
    });

    fs.rmSync(binary);
    fs.writeFileSync(binary, attacker, { mode: 0o700 });

    const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    const startTime = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    const signalled = helper.signal({ pid: child.pid, startTime, signal: 'SIGTERM' });
    await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 1_000))]);

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
    assert.equal(signalled.status, 'SIGNALLED_EXACT');
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'verified helper must deliver the exact signal');
    assert.equal(launched.status, 0);
    assert.equal(launched.stdout.trim(), output);
    assert.equal(fs.existsSync(sentinel), false, 'mutated or replacement helper bytes must never execute');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('automatic compilation consumes the exact source bytes that were hashed', { skip: !linux }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-linux-custody-source-binding-'));
  const sourcePath = path.join(root, 'linux-custody-helper.c');
  const sourceBytes = fs.readFileSync(path.join(import.meta.dirname, 'linux-custody-helper.c'));
  const expectedSourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  fs.writeFileSync(sourcePath, sourceBytes);
  let compileObserved = false;
  const run = (command, argv, options) => {
    if (argv.some((value) => value.includes('cana-linux-custody-build'))) {
      compileObserved = true;
      fs.writeFileSync(sourcePath, '#error attacker source must not compile\n');
      assert.deepEqual(options.input, sourceBytes);
      assert.equal(argv.includes(sourcePath), false, 'hashed source pathname must not reach the compiler');
      assert.equal(argv.some((value) => value.endsWith('/linux-custody-helper')), false,
        'compiler output must never expose a substitutable pathname');
    }
    return spawnSync(command, argv, options);
  };
  const helper = prepareLinuxCustodyHelper({ sourcePath, expectedSourceSha256, run });
  try {
    assert.equal(compileObserved, true);
    assert.equal(helper.sourceSha256, expectedSourceSha256);
    assert.match(fs.readFileSync(sourcePath, 'utf8'), /attacker source must not compile/);
  } finally {
    helper.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ambient dynamic-loader injection never reaches compiler, sealer, helper or launched process', { skip: !linux }, () => {
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
