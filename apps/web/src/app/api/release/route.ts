/**
 * GET /api/release — the exact Git release SHA of the RUNNING deployment.
 *
 * Purpose: let the repository and the runtime be compared. `git rev-parse` in
 * the repo names what SHOULD be deployed; this endpoint names what IS
 * deployed. The SHA comes from a build-time identity file written by
 * deploy/namecheap/build-artifact.mjs (release.json, receipt.json fallback) —
 * never from shelling out to git (a deployed artifact has no .git directory)
 * and never from a runtime environment variable (operator-typed values drift
 * from the running bytes).
 *
 * Absence is explicit and VISIBLE: a deployment without its identity file
 * answers 503 RELEASE_SHA_MISSING, because an artifact whose provenance
 * cannot be stated is a deployment defect (incident 2026-07-23: a live
 * artifact built from a commit unreachable in the remote). A 200 "unknown"
 * would hide that behind a green check.
 *
 * This endpoint publishes no data beyond build provenance: no counts, no
 * tenant information, no filesystem paths (source is a basename only).
 * Contract tests: apps/web/tests/release-sha.test.mjs.
 */
import { NextResponse } from 'next/server';
import {
  resolveReleaseIdentity,
  releaseResponseBody,
} from './release-identity.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = resolveReleaseIdentity();
  return NextResponse.json(releaseResponseBody(identity), {
    status: identity.httpStatus,
    headers: {
      // Release identity must never be cached: a stale SHA is a false claim
      // about what is running (same law as the truth-bearing v1 routes).
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
