-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "logo" TEXT,
    "themePrimary" TEXT NOT NULL DEFAULT '#0e9f5a',
    "themeSecondary" TEXT NOT NULL DEFAULT '#0a7443',
    "themeBg" TEXT NOT NULL DEFAULT '#f6faf7',
    "themeSurface" TEXT NOT NULL DEFAULT '#ffffff',
    "themeText" TEXT NOT NULL DEFAULT '#0d1f18',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "managedRetailerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retailer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'delivery',
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Washington',
    "state" TEXT NOT NULL DEFAULT 'DC',
    "zip" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "hours" TEXT NOT NULL DEFAULT '10:00 AM - 8:00 PM',
    "hoursSource" TEXT NOT NULL DEFAULT 'Retailer Submitted',
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "licenseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "licenseSource" TEXT NOT NULL DEFAULT 'DC ABCA Registry',
    "licenseNumber" TEXT,
    "lastLicenseCheck" TIMESTAMP(3),
    "lastInfoCheck" TIMESTAMP(3),
    "menuUpdatedAt" TIMESTAMP(3),
    "dealUpdatedAt" TIMESTAMP(3),
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthFailure" (
    "id" TEXT NOT NULL,
    "accountDigest" TEXT NOT NULL,
    "clientDigest" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSubmissionEvent" (
    "id" TEXT NOT NULL,
    "clientDigest" TEXT NOT NULL,
    "subjectDigest" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSubmissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseEvidence" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Retailer submission',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LicenseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRequest" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "requestedPasswordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "strainType" TEXT,
    "thcPercent" DOUBLE PRECISION,
    "cbdPercent" DOUBLE PRECISION,
    "image" TEXT,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuEntry" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandMenu" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "menuEntryId" TEXT NOT NULL,

    CONSTRAINT "BrandMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discount" TEXT,
    "code" TEXT,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIntelligenceSnapshot" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOf" TIMESTAMP(3) NOT NULL,
    "routeInventoryHash" TEXT NOT NULL,
    "localEvidenceStatus" TEXT NOT NULL,
    "externalEvidenceStatus" TEXT NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "attentionCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL,

    CONSTRAINT "SiteIntelligenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteObservation" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "observationKey" TEXT NOT NULL,
    "plane" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL,
    "preparedAction" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "quantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "pointsChanged" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image" TEXT,
    "author" TEXT NOT NULL DEFAULT 'Holding Editorial Staff',
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "filedBy" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'Legacy submission (reason not recorded)',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagingABCARetailer" (
    "id" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT,
    "rawJson" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagingABCARetailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandCreditEntry" (
    "seq" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "authorizationRef" TEXT,
    "expiresAt" TIMESTAMP(3),
    "placement" TEXT,
    "disclosureLabel" TEXT,
    "affectsOrganicOrder" BOOLEAN NOT NULL DEFAULT false,
    "originalSeq" INTEGER,
    "reason" TEXT,
    "actionKind" TEXT,
    "evidenceChain" TEXT,
    "evidenceChainSha256" TEXT,
    "observedAt" TIMESTAMP(3),
    "placementSeq" INTEGER,
    "relationshipOwner" TEXT,
    "exportableByMerchant" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventIdentity" TEXT,
    "proofState" TEXT,
    "valueEligible" BOOLEAN NOT NULL DEFAULT false,
    "interactionNonce" TEXT,
    "destination" TEXT,

    CONSTRAINT "DemandCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_domain_key" ON "Brand"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Retailer_licenseNumber_key" ON "Retailer"("licenseNumber");

-- CreateIndex
CREATE INDEX "Retailer_dataStatus_isDemonstration_freshnessExpiresAt_idx" ON "Retailer"("dataStatus", "isDemonstration", "freshnessExpiresAt");

-- CreateIndex
CREATE INDEX "Retailer_type_idx" ON "Retailer"("type");

-- CreateIndex
CREATE INDEX "Retailer_lastLicenseCheck_idx" ON "Retailer"("lastLicenseCheck");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthFailure_accountDigest_occurredAt_idx" ON "AuthFailure"("accountDigest", "occurredAt");

-- CreateIndex
CREATE INDEX "AuthFailure_clientDigest_occurredAt_idx" ON "AuthFailure"("clientDigest", "occurredAt");

-- CreateIndex
CREATE INDEX "AuthFailure_expiresAt_idx" ON "AuthFailure"("expiresAt");

-- CreateIndex
CREATE INDEX "PublicSubmissionEvent_surface_clientDigest_occurredAt_idx" ON "PublicSubmissionEvent"("surface", "clientDigest", "occurredAt");

-- CreateIndex
CREATE INDEX "PublicSubmissionEvent_surface_occurredAt_idx" ON "PublicSubmissionEvent"("surface", "occurredAt");

-- CreateIndex
CREATE INDEX "PublicSubmissionEvent_expiresAt_idx" ON "PublicSubmissionEvent"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSubmissionEvent_surface_subjectDigest_key" ON "PublicSubmissionEvent"("surface", "subjectDigest");

-- CreateIndex
CREATE INDEX "LicenseEvidence_verificationStatus_submittedAt_idx" ON "LicenseEvidence"("verificationStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "ClaimRequest_status_email_idx" ON "ClaimRequest"("status", "email");

-- CreateIndex
CREATE INDEX "ClaimRequest_status_createdAt_idx" ON "ClaimRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "MenuEntry_retailerId_updatedAt_idx" ON "MenuEntry"("retailerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuEntry_retailerId_productId_key" ON "MenuEntry"("retailerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandMenu_brandId_menuEntryId_key" ON "BrandMenu"("brandId", "menuEntryId");

-- CreateIndex
CREATE INDEX "Deal_retailerId_createdAt_idx" ON "Deal"("retailerId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_createdAt_idx" ON "LeadEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_retailerId_eventType_createdAt_idx" ON "LeadEvent"("retailerId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "SiteIntelligenceSnapshot_capturedAt_idx" ON "SiteIntelligenceSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "SiteIntelligenceSnapshot_fingerprint_capturedAt_idx" ON "SiteIntelligenceSnapshot"("fingerprint", "capturedAt");

-- CreateIndex
CREATE INDEX "SiteObservation_state_severity_idx" ON "SiteObservation"("state", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SiteObservation_snapshotId_observationKey_key" ON "SiteObservation"("snapshotId", "observationKey");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_userId_brandId_key" ON "LoyaltyAccount"("userId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Dispute_retailerId_status_fieldName_idx" ON "Dispute"("retailerId", "status", "fieldName");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StagingABCARetailer_licenseNumber_key" ON "StagingABCARetailer"("licenseNumber");

-- CreateIndex
CREATE INDEX "StagingABCARetailer_licenseNumber_idx" ON "StagingABCARetailer"("licenseNumber");

-- CreateIndex
CREATE INDEX "StagingABCARetailer_status_idx" ON "StagingABCARetailer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DemandCreditEntry_entryHash_key" ON "DemandCreditEntry"("entryHash");

-- CreateIndex
CREATE INDEX "DemandCreditEntry_merchantId_kind_idx" ON "DemandCreditEntry"("merchantId", "kind");

-- CreateIndex
CREATE INDEX "DemandCreditEntry_entryHash_idx" ON "DemandCreditEntry"("entryHash");

-- CreateIndex
CREATE INDEX "DemandCreditEntry_eventIdentity_idx" ON "DemandCreditEntry"("eventIdentity");

-- CreateIndex
CREATE INDEX "DemandCreditEntry_merchantId_interactionNonce_idx" ON "DemandCreditEntry"("merchantId", "interactionNonce");

-- CreateIndex
CREATE UNIQUE INDEX "DemandCreditEntry_merchantId_seq_key" ON "DemandCreditEntry"("merchantId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "DemandCreditEntry_merchantId_eventIdentity_key" ON "DemandCreditEntry"("merchantId", "eventIdentity");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managedRetailerId_fkey" FOREIGN KEY ("managedRetailerId") REFERENCES "Retailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvidence" ADD CONSTRAINT "LicenseEvidence_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuEntry" ADD CONSTRAINT "MenuEntry_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuEntry" ADD CONSTRAINT "MenuEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandMenu" ADD CONSTRAINT "BrandMenu_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandMenu" ADD CONSTRAINT "BrandMenu_menuEntryId_fkey" FOREIGN KEY ("menuEntryId") REFERENCES "MenuEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteObservation" ADD CONSTRAINT "SiteObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SiteIntelligenceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

