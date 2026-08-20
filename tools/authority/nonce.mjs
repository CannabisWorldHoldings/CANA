// tools/authority/nonce.mjs — PHASE E4: single-use owner-nonce consumption, atomic & serializable.
//
// The archaeology's unsettled item #4: "C persists owner-grant nonces as a JSON file; single-use is
// proven single-threaded" — concurrent redemption of one nonce must refuse all but one.
//
// This implements consumption as an APPEND-ONLY consumption record using the OS's atomic
// exclusive-create primitive: one file per nonce, opened with O_EXCL (Node flag 'wx'). The kernel
// guarantees exactly one openSync('wx') for a given path succeeds; every concurrent/subsequent caller
// gets EEXIST. There is no read-modify-write window, so 20 parallel PROCESSES racing the same nonce
// see exactly ONE win — proven by tools/authority/authority-court.test.mjs (concurrency probe).

import { openSync, closeSync, writeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class NonceStore {
  constructor(dir) {
    this.dir = join(dir, 'consumed-nonces');
    mkdirSync(this.dir, { recursive: true });
  }

  // Encode a nonce to a safe filename (nonces are caller-supplied strings).
  _path(nonce) {
    const safe = Buffer.from(String(nonce)).toString('hex');
    return join(this.dir, `${safe}.consumed`);
  }

  // Atomically CLAIM a nonce. Returns true iff THIS caller is the one that created the record.
  // O_EXCL is the whole guarantee: no lock, no read-then-write, no window.
  consume(nonce) {
    let fd;
    try {
      fd = openSync(this._path(nonce), 'wx'); // O_CREAT | O_EXCL — atomic exclusive create
    } catch (e) {
      if (e.code === 'EEXIST') return false; // already consumed by someone (or this same) attempt
      throw e;
    }
    try {
      writeSync(fd, JSON.stringify({ nonce, consumed_at: new Date().toISOString(), pid: process.pid }));
    } finally {
      closeSync(fd);
    }
    return true;
  }
}
