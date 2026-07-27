'use strict';

if (process.env.CANA_DETERMINISTIC_TEST_RANDOM === '1') {
  const crypto = require('node:crypto');
  const seed = process.env.CANA_DETERMINISTIC_TEST_SEED;
  if (!seed) throw new Error('CANA_DETERMINISTIC_TEST_SEED is required');
  let counter = 0n;

  crypto.randomBytes = function deterministicRandomBytes(size, callback) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError('random byte size must be a non-negative safe integer');
    }
    const output = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const block = crypto
        .createHmac('sha256', seed)
        .update(counter.toString(16).padStart(16, '0'))
        .digest();
      counter += 1n;
      block.copy(output, offset, 0, Math.min(block.length, size - offset));
      offset += block.length;
    }
    if (typeof callback === 'function') {
      queueMicrotask(() => callback(null, output));
      return undefined;
    }
    return output;
  };
  require('node:module').syncBuiltinESMExports();
}
