/**
 * SiteMind Provider-Neutral Model Router
 * Routes image generation and vision quality evaluation tasks based on constraints and historical quality.
 * Reuses @owd/ai gateway contract for provider-free quality stage evaluation.
 */

import { executeParallelPrompts, LOCAL_QUALITY_STAGE_REGISTRY } from '../../../../../packages/ai/src/gateway.mjs';

export const PROVIDER_REGISTRY = Object.freeze({
  'cana-hermes': {
    name: 'CANA Hermes Local Deterministic Facade',
    capabilities: ['IMAGE_GEN', 'TYPOGRAPHY', 'LOGO_FIDELITY', 'LOCAL_MOCK_RENDER'],
    costPerGen: 0.0,
    averageLatencyMs: 150,
    historicalApprovalRate: 0.95,
  },
  'openai-dalle3': {
    name: 'OpenAI DALL-E 3 (Configured Provider)',
    capabilities: ['IMAGE_GEN', 'HIGH_RES', 'PROMPT_COMPLIANCE'],
    costPerGen: 0.04,
    averageLatencyMs: 4000,
    historicalApprovalRate: 0.85,
  },
  'stability-sd3': {
    name: 'Stability SD3 (Configured Provider)',
    capabilities: ['IMAGE_GEN', 'PHOTOREALISM', 'CANVAS_CONTROL'],
    costPerGen: 0.03,
    averageLatencyMs: 2500,
    historicalApprovalRate: 0.80,
  },
});

export async function routeCreativeModelTask({
  taskType,
  prompt,
  preferredProvider = 'cana-hermes',
}) {
  // Execute deterministic gateway check from @owd/ai workspace package
  const gatewayResults = await executeParallelPrompts([prompt], `sitemind-router/${taskType}`);

  const providerKey = PROVIDER_REGISTRY[preferredProvider] ? preferredProvider : 'cana-hermes';
  const providerSpec = PROVIDER_REGISTRY[providerKey];

  return {
    selectedProvider: providerKey,
    providerName: providerSpec.name,
    costEstimate: providerSpec.costPerGen,
    expectedLatencyMs: providerSpec.averageLatencyMs,
    gatewayReceipt: JSON.parse(gatewayResults[0]),
    qualityStages: LOCAL_QUALITY_STAGE_REGISTRY,
    routedAt: new Date().toISOString(),
  };
}
