/**
 * GET /api/release — the exact Git release SHA of the RUNNING deployment.
 *
 * Purpose: let the repository and the runtime be compared. `git rev-parse` in
 * the repo names what SHOULD be deployed; this endpoint names what IS
 * deployed. The SHA comes from a build-time identity file written by
 * deploy/namecheap/build-artifact.mjs (release.json, receipt.json fallback).
 * Platform artifacts that cannot retain those root files use the SHA Next
 * compiled into the Worker bytes during the exact-source build court. Neither
 * path shells out to git or trusts an operator-typed runtime SHA.
 *
 * Absence is explicit and VISIBLE: a deployment without either identity form
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
  resolveReleaseIdentityWithBundledSha,
  releaseResponseBody,
} from './release-identity.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = resolveReleaseIdentityWithBundledSha({
    bundledSha: process.env.CANA_RELEASE_SHA,
  });
  return NextResponse.json(releaseResponseBody(identity), {
    status: identity.httpStatus,
    headers: {
      // Release identity must never be cached: a stale SHA is a false claim
      // about what is running (same law as the truth-bearing v1 routes).
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
