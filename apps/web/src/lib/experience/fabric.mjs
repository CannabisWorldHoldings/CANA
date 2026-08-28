// FABRIC BRIDGE — the application's single seam into the Experience Fabric kernel.
//
// This is the file whose existence changes a measured fact: before it, the count of
// imports of tools/experience-fabric from apps/web/src was ZERO. The kernel was
// sophisticated, tested, and unreachable from anything a customer could load.
//
// Everything here is deliberately thin. The kernel owns mutation, courts, conflict
// detection, receipts, approval and rollback; reimplementing any of that would create a
// second owner for a job that already has one. This module only:
//   1. gives the application a way in,
//   2. pins presentation patches to the one legal write surface, and
//   3. reports refusal honestly instead of rendering a half-applied experience.

import {
  ExperienceFabric,
  stateAddress,
  validateIntentPatch,
} from '../../../../../tools/experience-fabric/kernel.mjs';

import { PRESENTATION_WRITE_SET, assertManifest } from './manifest.mjs';

/**
 * Content address of a manifest. Two manifests with the same address are the same
 * experience byte for byte — the anchor exact rollback is verified against.
 */
export function manifestAddress(manifest) {
  assertManifest(manifest);
  return stateAddress(manifest);
}

/** Open a kernel session over a manifest. The session owns head, history and receipts. */
export function openExperience(manifest) {
  assertManifest(manifest);
  return new ExperienceFabric(manifest);
}

/**
 * Build a presentation patch.
 *
 * The write set is FIXED to `presentation.*` rather than accepted from the caller. That
 * is the point: a caller cannot widen its own authority by declaring a broader surface.
 * Merchant identity, inventory, verified availability, the accessibility contract and
 * economics are protected paths the kernel refuses by default-deny; fixing the write set
 * here makes ordinary presentation work unable to even ask.
 */
export function presentationPatch({ goal, scope, agent, risk = 'R1', mutation }) {
  const patch = {
    goal,
    scope,
    agent,
    risk,
    write_set: [...PRESENTATION_WRITE_SET],
    mutation,
  };
  validateIntentPatch(patch);
  return patch;
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Apply a presentation patch and report honestly.
 *
 * On refusal this returns the ORIGINAL manifest, never a partially-mutated one. A
 * half-applied experience is worse than a rejected one because it still renders, so
 * nobody notices the court failed. Refusal must be loud in the return value and
 * invisible in the rendered page.
 *
 * The kernel does NOT move HEAD on a private mutation — publishing requires approve()
 * then promote(). This function therefore previews; it never publishes. An agent cannot
 * ship to a customer surface on its own authority.
 */
export function applyPresentation(manifest, patch) {
  const rollbackTo = manifestAddress(manifest);
  const session = openExperience(manifest);
  const outcome = session.mutatePrivate(patch);
  const admitted = outcome.court.verdict === 'PASS' && outcome.candidate !== null;

  let candidateManifest = manifest;
  if (admitted) {
    const next = JSON.parse(JSON.stringify(manifest));
    for (const [path, value] of Object.entries(patch.mutation)) setPath(next, path, value);
    assertManifest(next);
    candidateManifest = next;
  }

  return {
    candidate: outcome.candidate,
    admitted,
    court: outcome.court,
    manifest: candidateManifest,
    rollbackTo,
    session,
  };
}

/**
 * Publish a courted candidate: merchant approval, then promotion. Both are explicit,
 * both are recorded. Kept as one function so the ordering cannot be got wrong, but the
 * merchant identity stays a required argument so approval can never be implied.
 */
export function publishPresentation(result, merchant) {
  if (!result.admitted || !result.candidate) {
    throw new Error('PUBLISH_REFUSED: a candidate that failed its court is never publishable');
  }
  result.session.approve(result.candidate, { merchant });
  return result.session.promote(result.candidate);
}
