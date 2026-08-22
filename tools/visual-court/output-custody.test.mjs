import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createOutputCustody } from './output-custody.mjs';

function pathWriter() {
  return {
    write({ rootPath, relativePath, bytes }) {
      const target = path.join(rootPath, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      return { status: 'WROTE', bytes: Buffer.byteLength(bytes) };
    },
  };
}

test('PNG verdict and failure artifacts share descriptor custody', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-output-custody-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(sourceRoot);
  const custody = createOutputCustody(outputRoot, { sourceRoot, tempRoot: root, writer: pathWriter() });
  try {
    custody.writeArtifact('_home/light/430.png', Buffer.from('png'));
    custody.writeArtifact('rendered-verdict.json', Buffer.from('{"verdict":"PASS"}'));
    custody.writeArtifact('rendered-failure.json', Buffer.from('{"failure":"control"}'));
    assert.equal(fs.readFileSync(path.join(outputRoot, '_home/light/430.png'), 'utf8'), 'png');
    assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, 'rendered-verdict.json'))).verdict, 'PASS');
    assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, 'rendered-failure.json'))).failure, 'control');
  } finally {
    custody.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ancestor swap never enters source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-output-custody-swap-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(sourceRoot);
  const custody = createOutputCustody(outputRoot, { sourceRoot, tempRoot: root, writer: pathWriter() });
  try {
    fs.renameSync(outputRoot, `${outputRoot}.held`);
    fs.symlinkSync(sourceRoot, outputRoot, 'dir');
    assert.throws(() => custody.writeArtifact('TOCTOU_SENTINEL', Buffer.from('blocked')), /OUTPUT_BINDING_LOST/);
    assert.equal(fs.existsSync(path.join(sourceRoot, 'TOCTOU_SENTINEL')), false);
    assert.throws(() => custody.close(), /OUTPUT_BINDING_LOST/);
  } finally {
    try { custody.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exclusive artifact creation refuses replacement and traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-output-custody-exclusive-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(sourceRoot);
  const custody = createOutputCustody(outputRoot, { sourceRoot, tempRoot: root, writer: pathWriter() });
  try {
    custody.writeArtifact('receipt.json', Buffer.from('first'));
    assert.throws(() => custody.writeArtifact('receipt.json', Buffer.from('second')));
    assert.throws(() => custody.writeArtifact('../source/sentinel', Buffer.from('blocked')), /OUTPUT_WRITE_REFUSED/);
    assert.throws(() => custody.writeArtifact('..\\source\\sentinel', Buffer.from('blocked')), /OUTPUT_WRITE_REFUSED/);
    assert.equal(fs.readFileSync(path.join(outputRoot, 'receipt.json'), 'utf8'), 'first');
    assert.equal(fs.existsSync(path.join(sourceRoot, 'sentinel')), false);
  } finally {
    custody.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an existing non-private output root is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-output-custody-mode-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(outputRoot, { mode: 0o755 });
  try {
    assert.throws(
      () => createOutputCustody(outputRoot, { sourceRoot, tempRoot: root, writer: pathWriter() }),
      /OUTPUT_ROOT_NOT_PRIVATE/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
