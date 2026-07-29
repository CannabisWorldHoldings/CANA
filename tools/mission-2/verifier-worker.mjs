import fs from 'node:fs';
import { IndependentVerifier } from './verifier.mjs';

function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const executionReceipt = {
    ...payload.executionReceipt,
    before_bytes: Buffer.from(payload.executionReceipt.before_bytes, 'base64'),
    after_bytes: Buffer.from(payload.executionReceipt.after_bytes, 'base64'),
  };
  const receipt = new IndependentVerifier(payload.mission.verifier_identity).verify({
    ...payload,
    executionReceipt,
    now: new Date(payload.now),
    verificationBoundary: 'SEPARATE_PROCESS',
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${error?.code ?? error?.name ?? 'VERIFIER_WORKER_FAILED'}: ${message}\n`);
  process.exitCode = 1;
}
