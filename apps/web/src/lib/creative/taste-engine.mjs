/**
 * SiteMind Owner Taste & Rejection Engine
 * Governs brand preferences, visual tastes, and rejection memory with decision superseding lineage and tenant isolation.
 */

import { prisma } from '../prisma.mjs';

export const SEEDED_BRAND_PREFERENCES = Object.freeze([
  {
    ruleId: 'taste-seed-001',
    tenantId: 'orderweeddc',
    ruleCategory: 'VISUAL_PREFERENCE',
    ruleText: 'Primary canvas must use bright white daylight background or glossy dark-green night mode.',
    status: 'ACTIVE',
    weight: 0.95,
  },
  {
    ruleId: 'taste-seed-002',
    tenantId: 'orderweeddc',
    ruleCategory: 'TYPOGRAPHY_PREFERENCE',
    ruleText: 'Brand ribbon wordmark must use dark forest green cursive font for orderweeddc.',
    status: 'ACTIVE',
    weight: 0.95,
  },
  {
    ruleId: 'taste-seed-003',
    tenantId: 'orderweeddc',
    ruleCategory: 'VISUAL_PREFERENCE',
    ruleText: 'Brand wordmark must feature an extended lowercase d forming the top edge of a leaf icon.',
    status: 'ACTIVE',
    weight: 0.95,
  },
  {
    ruleId: 'taste-seed-004',
    tenantId: 'orderweeddc',
    ruleCategory: 'VALUE_PREFERENCE',
    ruleText: 'Must emphasize D.C. local culture, verified license freshness, and fast local delivery.',
    status: 'ACTIVE',
    weight: 0.90,
  },
  {
    ruleId: 'taste-seed-005',
    tenantId: 'orderweeddc',
    ruleCategory: 'ACCESSIBILITY_PREFERENCE',
    ruleText: 'Must maintain WCAG AAA contrast ratio (7:1+) on mobile displays.',
    status: 'ACTIVE',
    weight: 0.90,
  },
]);

export const SEEDED_REJECTION_RULES = Object.freeze([
  {
    ruleId: 'rejection-seed-001',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject mint green or neon green background colors.',
    status: 'ACTIVE',
    weight: 0.95,
  },
  {
    ruleId: 'rejection-seed-002',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject corporate B2B analytics card designs with dark background and neon bar charts in consumer hero banner.',
    status: 'ACTIVE',
    weight: 0.95,
  },
  {
    ruleId: 'rejection-seed-003',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject stock leaf clipart, generic cannabis imagery, or cartoon mascots.',
    status: 'ACTIVE',
    weight: 0.90,
  },
  {
    ruleId: 'rejection-seed-004',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject weak, unreadable, or illegible wordmarks on small mobile screens.',
    status: 'ACTIVE',
    weight: 0.90,
  },
  {
    ruleId: 'rejection-seed-005',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject cluttered multi-banner carousels or low-contrast text overlays.',
    status: 'ACTIVE',
    weight: 0.90,
  },
  {
    ruleId: 'rejection-seed-006',
    tenantId: 'orderweeddc',
    ruleCategory: 'REJECTED_PATTERN',
    ruleText: 'Reject any unlicensed competitor asset copying or direct competitor logo reproduction.',
    status: 'ACTIVE',
    weight: 1.0,
  },
]);

export async function seedTasteMemory(tenantId = 'orderweeddc') {
  const allSeeds = [...SEEDED_BRAND_PREFERENCES, ...SEEDED_REJECTION_RULES];
  for (const seed of allSeeds) {
    await prisma.ownerTasteRule.upsert({
      where: { ruleId: seed.ruleId },
      create: {
        ruleId: seed.ruleId,
        tenantId,
        ruleCategory: seed.ruleCategory,
        ruleText: seed.ruleText,
        status: seed.status,
        weight: seed.weight,
      },
      update: {},
    });
  }
}

export async function recordOwnerDecisionRule({
  ruleId,
  tenantId = 'orderweeddc',
  ruleCategory,
  ruleText,
  supersedesRuleId,
  isTestFixture = false,
  eligibleForRealMemory = true,
}) {
  if (supersedesRuleId) {
    await prisma.ownerTasteRule.updateMany({
      where: { ruleId: supersedesRuleId, tenantId },
      data: { status: 'SUPERSEDE' },
    });
  }

  // If this is a test fixture or explicitly not eligible for real memory, isolate it
  const isEligible = eligibleForRealMemory && !isTestFixture;

  const created = await prisma.ownerTasteRule.create({
    data: {
      ruleId,
      tenantId,
      ruleCategory: isEligible ? ruleCategory : `TEST_FIXTURE_${ruleCategory}`,
      ruleText: isEligible ? ruleText : `[TEST_FIXTURE_ISOLATED] ${ruleText}`,
      supersedesRuleId: supersedesRuleId ?? null,
      status: isEligible ? 'ACTIVE' : 'TEST_FIXTURE_ISOLATED',
      weight: isEligible ? 0.9 : 0.0,
    },
  });

  return created;
}

export async function getActiveTasteRules(includeTestFixtures = false, tenantId = 'orderweeddc') {
  await seedTasteMemory(tenantId);
  const rules = await prisma.ownerTasteRule.findMany({
    where: {
      tenantId,
      status: includeTestFixtures
        ? { in: ['ACTIVE', 'TEST_FIXTURE_ISOLATED'] }
        : 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    preferences: rules.filter((r) => r.ruleCategory === 'VISUAL_PREFERENCE' || r.ruleCategory === 'TYPOGRAPHY_PREFERENCE' || r.ruleCategory === 'VALUE_PREFERENCE' || r.ruleCategory === 'ACCESSIBILITY_PREFERENCE'),
    rejectionRules: rules.filter((r) => r.ruleCategory === 'REJECTED_PATTERN'),
    allRules: rules,
  };
}
