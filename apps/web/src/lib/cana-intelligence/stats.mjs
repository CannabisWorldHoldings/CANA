export function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

export function twoProportion(sControl, nControl, sTreatment, nTreatment) {
  if (nControl < 1 || nTreatment < 1) return null;
  const p1 = sControl / nControl;
  const p2 = sTreatment / nTreatment;
  const pooled = (sControl + sTreatment) / (nControl + nTreatment);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nControl + 1 / nTreatment));
  const seDiff = Math.sqrt((p1 * (1 - p1)) / nControl + (p2 * (1 - p2)) / nTreatment);
  const z = se === 0 ? 0 : (p2 - p1) / se;
  return { controlRate: p1, treatmentRate: p2, lift: p2 - p1, z, ciLo: p2 - p1 - 1.96 * seDiff, ciHi: p2 - p1 + 1.96 * seDiff };
}
