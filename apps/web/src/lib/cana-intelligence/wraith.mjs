import { assert, deepFreeze, digest } from './core.mjs';
import { assertIndependentVerifier } from './authority.mjs';

export async function wraithAttack({ candidate, proposerId, attacks, attacker, judge }) {
  assert(Array.isArray(attacks) && attacks.length > 0, 'attacks required');
  assert(typeof attacker === 'function' && typeof judge === 'function', 'attacker and judge adapters required');
  const results = [];
  for (const attack of attacks) {
    const attacked = await attacker({ candidate, attack });
    const judgment = await judge({ candidate, attack, attacked });
    assertIndependentVerifier({ proposerId, verifierId: judgment.verifierId });
    results.push(deepFreeze({ attackId: attack.id, attackedDigest: digest(attacked, 'wraith-output'), judgment }));
  }
  const failures = results.filter((r) => r.judgment.verdict !== 'PASS');
  return deepFreeze({
    candidateDigest: digest(candidate, 'candidate'), passed: failures.length === 0, results, failures,
    brittlePoint: failures.sort((a, b) => Number(b.judgment.severity ?? 0) - Number(a.judgment.severity ?? 0))[0] ?? null,
  });
}
