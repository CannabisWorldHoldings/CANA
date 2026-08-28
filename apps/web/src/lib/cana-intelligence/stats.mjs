export function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

// Acklam's inverse-normal approximation. It keeps the preregistered alpha
// policy executable without accepting a new confidence threshold at settlement.
function inverseNormal(probability) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function normalCriticalValue(alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha must be between zero and one');
  return inverseNormal(1 - alpha / 2);
}

export function twoProportion(sControl, nControl, sTreatment, nTreatment, zCritical = 1.96) {
  if (nControl < 1 || nTreatment < 1) return null;
  const p1 = sControl / nControl;
  const p2 = sTreatment / nTreatment;
  const pooled = (sControl + sTreatment) / (nControl + nTreatment);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nControl + 1 / nTreatment));
  const seDiff = Math.sqrt((p1 * (1 - p1)) / nControl + (p2 * (1 - p2)) / nTreatment);
  const z = se === 0 ? 0 : (p2 - p1) / se;
  return { controlRate: p1, treatmentRate: p2, lift: p2 - p1, z, criticalValue: zCritical, ciLo: p2 - p1 - zCritical * seDiff, ciHi: p2 - p1 + zCritical * seDiff };
}
