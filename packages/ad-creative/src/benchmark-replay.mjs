export function evaluateBenchmarkReplay({
  benchmarkId,
  expected,
  observed,
  maxScoreDrift = 0.05,
}) {
  if (!benchmarkId || !expected?.requestSha256 || !observed?.requestSha256) {
    throw new TypeError('benchmark replay requires benchmark and request identities');
  }
  const identityMatch =
    expected.provider === observed.provider &&
    expected.model === observed.model &&
    expected.requestSha256 === observed.requestSha256;
  const scoreDrift =
    typeof expected.visualScore === 'number' && typeof observed.visualScore === 'number'
      ? Number(Math.abs(expected.visualScore - observed.visualScore).toFixed(6))
      : null;
  const driftDetected = !identityMatch || scoreDrift === null || scoreDrift > maxScoreDrift;
  return Object.freeze({
    benchmarkId,
    identityMatch,
    scoreDrift,
    maxScoreDrift,
    driftDetected,
    productionPromotionAllowed: false,
  });
}
