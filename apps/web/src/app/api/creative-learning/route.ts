/**
 * SiteMind Creative Learning REST API Endpoint
 * Admin governance endpoint for inspecting active rules and running vertical slice evaluations.
 * Protected: Requires Admin / Owner Session Authentication and Tenant Host Validation.
 */

import { NextResponse } from 'next/server';
import { handleGetCreativeLearning, handlePostCreativeLearning } from '@/lib/creative/api-handler.mjs';

export async function GET(request: Request) {
  const result = await handleGetCreativeLearning(request);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  const result = await handlePostCreativeLearning(request);
  return NextResponse.json(result.body, { status: result.status });
}
