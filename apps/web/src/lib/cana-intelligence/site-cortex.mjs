import { assert, deepFreeze, digest, sealPlain } from './core.mjs';
import {
  requireExactEvidenceRealm,
  resolveCanonicalReceipt,
  validateReceiptShape,
} from './receipts.mjs';

const SHA_256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40}$/;

export function createSiteCortexAdapter(impl) {
  for (const key of ['enumerateExperienceSurfaces', 'loadExperienceManifest', 'captureRenderedEvidenceReceipt', 'persistExperienceCandidate', 'loadReceipt']) {
    assert(typeof impl?.[key] === 'function', `site cortex adapter missing ${key}`, 'SITE_CORTEX_ADAPTER_INCOMPLETE');
  }
  return deepFreeze({ ...impl, ownsRoutes: false, ownsTruthStore: false, ownsAuth: false });
}

export function validateBrowserObservationReceipt(receipt, {
  candidateDigest = null,
  route = null,
  commit = null,
  tree = null,
  evidenceRealm = null,
} = {}) {
  validateReceiptShape(receipt, { kind: 'BROWSER_OBSERVATION' });
  if (evidenceRealm) requireExactEvidenceRealm(receipt, evidenceRealm);
  const payload = receipt.payload ?? {};
  assert(typeof payload.route === 'string' && payload.route.startsWith('/'), 'browser receipt route required', 'BROWSER_RECEIPT_ROUTE_REQUIRED');
  assert(payload.candidateDigest || payload.experienceDigest, 'browser receipt candidate/experience digest required', 'BROWSER_RECEIPT_CANDIDATE_REQUIRED');
  assert(GIT_OBJECT.test(payload.commit), 'browser receipt commit required', 'BROWSER_RECEIPT_COMMIT_REQUIRED');
  assert(GIT_OBJECT.test(payload.tree), 'browser receipt tree required', 'BROWSER_RECEIPT_TREE_REQUIRED');
  assert(typeof payload.browser === 'string' && payload.browser, 'browser receipt browser required', 'BROWSER_RECEIPT_BROWSER_REQUIRED');
  assert(typeof payload.browserVersion === 'string' && payload.browserVersion, 'browser receipt browser version required', 'BROWSER_RECEIPT_BROWSER_REQUIRED');
  assert(payload.viewport && typeof payload.viewport === 'object' && Number(payload.viewport.width) > 0 && Number(payload.viewport.height) > 0, 'browser receipt viewport required', 'BROWSER_RECEIPT_VIEWPORT_REQUIRED');
  assert(SHA_256.test(payload.screenshotDigest), 'browser receipt screenshot digest invalid', 'BROWSER_RECEIPT_SCREENSHOT_REQUIRED');
  assert(SHA_256.test(payload.domDigest), 'browser receipt DOM digest invalid', 'BROWSER_RECEIPT_DOM_REQUIRED');
  assert(Number.isFinite(new Date(payload.capturedAt).getTime()), 'browser receipt capturedAt required', 'BROWSER_RECEIPT_CAPTURED_AT_REQUIRED');
  assert(payload.consoleResult && typeof payload.consoleResult === 'object' && typeof payload.consoleResult.status === 'string', 'browser receipt console result required', 'BROWSER_RECEIPT_CONSOLE_REQUIRED');
  assert(payload.accessibilityResult && typeof payload.accessibilityResult === 'object' && typeof payload.accessibilityResult.status === 'string', 'browser receipt accessibility result required', 'BROWSER_RECEIPT_ACCESSIBILITY_REQUIRED');
  if (candidateDigest) assert(payload.candidateDigest === candidateDigest, 'browser candidate digest mismatch', 'BROWSER_RECEIPT_CANDIDATE_MISMATCH');
  if (route) assert(payload.route === route, 'browser route mismatch', 'BROWSER_RECEIPT_ROUTE_MISMATCH');
  if (commit) assert(payload.commit === commit, 'browser commit mismatch', 'BROWSER_RECEIPT_COMMIT_MISMATCH');
  if (tree) assert(payload.tree === tree, 'browser tree mismatch', 'BROWSER_RECEIPT_TREE_MISMATCH');
  return receipt;
}

export async function observeCustomerSite(adapter) {
  const surfaces = await adapter.enumerateExperienceSurfaces();
  assert(Array.isArray(surfaces), 'enumerateExperienceSurfaces must return array', 'SITE_ENUM_INVALID');
  const rows = [];
  for (const surface of surfaces) {
    const manifest = await adapter.loadExperienceManifest(surface);
    const receiptDigest = await adapter.captureRenderedEvidenceReceipt(surface);
    let receipt = null;
    let perceptionState = 'CAPABILITY_GAP';
    let capabilityGap = receiptDigest ? 'BROWSER_RECEIPT_INCOMPLETE' : 'BROWSER_OBSERVATION_MISSING';
    if (receiptDigest) {
      receipt = await resolveCanonicalReceipt(adapter, receiptDigest, { kind: 'BROWSER_OBSERVATION', minimumRealm: 'VERIFIED_LOCAL' });
      try {
        validateBrowserObservationReceipt(receipt, { route: surface.route ?? surface });
        perceptionState = 'OBSERVED_RENDERED_REALITY';
        capabilityGap = null;
      } catch (error) {
        capabilityGap = error.code ?? 'BROWSER_RECEIPT_INCOMPLETE';
      }
    }
    rows.push({
      surface,
      manifest: manifest ?? null,
      browserObservationReceipt: perceptionState === 'OBSERVED_RENDERED_REALITY' ? receipt.receiptDigest : null,
      perceptionState,
      capabilityGap,
    });
  }
  const graph = {
    surfaces: rows,
    nodes: rows.flatMap((row) => [
      { id: `route:${row.surface.route ?? row.surface}`, kind: 'ROUTE' },
      ...(row.manifest?.sections ?? []).map((section, index) => ({ id: `section:${row.surface.route ?? row.surface}:${section.id ?? index}`, kind: 'SECTION' })),
    ]),
  };
  return sealPlain({ ...graph, digest: digest(graph, 'site_cortex') });
}

export function fullFabricCoverage(observation) {
  const rows = observation?.surfaces ?? [];
  const total = rows.length;
  if (!total) return sealPlain({ total: 0, manifestCoverage: 0, visionCoverage: 0, status: 'NO_SURFACES' });
  const manifestCoverage = rows.filter((row) => row.manifest).length / total;
  const visionCoverage = rows.filter((row) => row.perceptionState === 'OBSERVED_RENDERED_REALITY').length / total;
  return sealPlain({
    total,
    manifestCoverage,
    visionCoverage,
    status: manifestCoverage === 1 && visionCoverage === 1 ? 'FULLY_OBSERVED' : 'PARTIAL',
  });
}
