import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertMission,
  deepFreeze,
} from './canonical.mjs';

const WORKER = fileURLToPath(new URL('./verifier-worker.mjs', import.meta.url));

export function runIndependentVerification({
  mission,
  authorization,
  executionReceipt,
  sandboxRoot,
  operation,
  lease,
  now,
  expectedText,
  leaseAuthorityPublicKey,
}) {
  const payload = {
    mission,
    authorization,
    executionReceipt: {
      ...executionReceipt,
      before_bytes: executionReceipt.before_bytes.toString('base64'),
      after_bytes: executionReceipt.after_bytes.toString('base64'),
    },
    sandboxRoot,
    operation,
    lease,
    now: now.toISOString(),
    expectedText,
    leaseAuthorityPublicKey,
  };
  const result = spawnSync(process.execPath, [WORKER], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const workerCode = /^([A-Z][A-Z0-9_]+):/.exec(stderr)?.[1]
      ?? 'INDEPENDENT_VERIFIER_PROCESS_FAILED';
    assertMission(false, workerCode, 'Independent verifier process failed closed', { stderr });
  }
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    assertMission(
      false,
      'INDEPENDENT_VERIFIER_OUTPUT_INVALID',
      'Independent verifier process returned malformed output',
    );
  }
  return deepFreeze(receipt);
}
