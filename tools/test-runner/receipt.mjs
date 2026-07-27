import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

function receiptSession() {
  const sessionFile = process.env.CANA_RECEIPT_SESSION;
  if (!sessionFile) return null;
  const file = path.resolve(sessionFile);
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  const directory = path.resolve(session.receiptDirectory ?? '');
  if (
    session.schemaVersion !== 1 ||
    session.kind !== 'cana-final-receipt-session' ||
    !/^[0-9a-f-]{36}$/.test(session.sessionId ?? '') ||
    !/^[0-9a-f]{64}$/.test(session.nonce ?? '') ||
    path.dirname(file) !== path.dirname(directory) ||
    path.basename(directory) !== 'receipts'
  ) {
    throw new Error('invalid CANA receipt session');
  }
  if (
    process.env.CANA_RECEIPT_DIR &&
    path.resolve(process.env.CANA_RECEIPT_DIR) !== directory
  ) {
    throw new Error('CANA receipt directory does not match its session');
  }
  return { file, session, directory };
}

export function receiptDirectory() {
  const activeSession = receiptSession();
  const directory =
    activeSession?.directory ??
    process.env.CANA_RECEIPT_DIR ??
    path.join(os.tmpdir(), 'cana-receipts');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.resolve(directory);
}

export function writeReceipt(kind, payload) {
  const activeSession = receiptSession();
  const safeKind = String(kind).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const file = path.join(
    receiptDirectory(),
    `${safeKind}-${stamp}-${crypto.randomBytes(4).toString('hex')}.json`,
  );
  const body = {
    ...payload,
    schemaVersion: 1,
    kind,
    recordedAt: new Date().toISOString(),
    receiptSession: activeSession
      ? {
          sessionId: activeSession.session.sessionId,
          nonceSha256: sha256Bytes(activeSession.session.nonce),
          startedAt: activeSession.session.startedAt,
          source: activeSession.session.source,
          trustedAttestation: false,
        }
      : null,
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
