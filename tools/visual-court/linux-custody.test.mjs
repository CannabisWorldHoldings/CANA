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
