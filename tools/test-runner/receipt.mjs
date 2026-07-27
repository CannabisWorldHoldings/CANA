import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

export function receiptDirectory() {
  const directory =
    process.env.CANA_RECEIPT_DIR ??
    path.join(os.tmpdir(), 'cana-receipts');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.resolve(directory);
}

export function writeReceipt(kind, payload) {
  const safeKind = String(kind).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const file = path.join(
    receiptDirectory(),
    `${safeKind}-${stamp}-${crypto.randomBytes(4).toString('hex')}.json`,
  );
  const body = {
    schemaVersion: 1,
    kind,
    recordedAt: new Date().toISOString(),
    ...payload,
  };
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, file);
  return { file, body, sha256: sha256File(file) };
}
