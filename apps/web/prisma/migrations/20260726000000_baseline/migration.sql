-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "managedRetailerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_managedRetailerId_fkey" FOREIGN KEY ("managedRetailerId") REFERENCES "Retailer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Retailer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'delivery',
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Washington',
    "state" TEXT NOT NULL DEFAULT 'DC',
    "zip" TEXT,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "hours" TEXT NOT NULL DEFAULT '10:00 AM - 8:00 PM',
    "hoursSource" TEXT NOT NULL DEFAULT 'Retailer Submitted',
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "licenseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "licenseSource" TEXT NOT NULL DEFAULT 'DC ABCA Registry',
    "licenseNumber" TEXT,
    "lastLicenseCheck" DATETIME,
    "lastInfoCheck" DATETIME,
    "menuUpdatedAt" DATETIME,
    "dealUpdatedAt" DATETIME,
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "verifiedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthFailure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountDigest" TEXT NOT NULL,
    "clientDigest" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PublicSubmissionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientDigest" TEXT NOT NULL,
    "subjectDigest" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LicenseEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "notes" TEXT,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Retailer submission',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "LicenseEvidence_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "requestedPasswordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClaimRequest_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "strainType" TEXT,
    "thcPercent" REAL,
    "cbdPercent" REAL,
    "image" TEXT,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "verifiedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MenuEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "verifiedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuEntry_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandMenu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "menuEntryId" TEXT NOT NULL,
    CONSTRAINT "BrandMenu_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandMenu_menuEntryId_fkey" FOREIGN KEY ("menuEntryId") REFERENCES "MenuEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discount" TEXT,
    "code" TEXT,
    "expiryDate" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "verifiedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deal_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadEvent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadEvent_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteIntelligenceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "capturedById" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOf" DATETIME NOT NULL,
    "routeInventoryHash" TEXT NOT NULL,
    "localEvidenceStatus" TEXT NOT NULL,
    "externalEvidenceStatus" TEXT NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "attentionCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "SiteObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SiteIntelligenceSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoyaltyAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loyaltyAccountId" TEXT NOT NULL,
    "pointsChanged" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyTransaction_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "LoyaltyAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image" TEXT,
    "author" TEXT NOT NULL DEFAULT 'Holding Editorial Staff',
    "dataStatus" TEXT NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "dataSource" TEXT NOT NULL DEFAULT 'Unspecified',
    "sourceUrl" TEXT,
    "retrievedAt" DATETIME,
    "verifiedAt" DATETIME,
    "freshnessExpiresAt" DATETIME,
    "confidence" REAL,
    "reviewedBy" TEXT,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT NOT NULL,
    "filedBy" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'Legacy submission (reason not recorded)',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispute_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StagingABCARetailer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeName" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT,
    "rawJson" TEXT,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DemandCreditEntry" (
    "seq" INTEGER NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "authorizationRef" TEXT,
    "expiresAt" DATETIME,
    "placement" TEXT,
    "disclosureLabel" TEXT,
    "affectsOrganicOrder" BOOLEAN NOT NULL DEFAULT false,
    "originalSeq" INTEGER,
    "reason" TEXT,
    "actionKind" TEXT,
    "evidenceChain" TEXT,
    "evidenceChainSha256" TEXT,
    "observedAt" DATETIME,
    "placementSeq" INTEGER,
    "relationshipOwner" TEXT,
    "exportableByMerchant" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventIdentity" TEXT,
    "proofState" TEXT,
    "valueEligible" BOOLEAN NOT NULL DEFAULT false,
    "interactionNonce" TEXT,
    "destination" TEXT
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

