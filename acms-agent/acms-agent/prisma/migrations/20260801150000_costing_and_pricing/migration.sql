-- CreateEnum
CREATE TYPE "CostingScenarioType" AS ENUM ('SELF_EXECUTION', 'FULL_SUBCONTRACTING', 'MIXED_MODEL', 'IMPORTED_MATERIALS', 'LOCAL_MATERIALS');

-- CreateEnum
CREATE TYPE "CostingVersionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CostPackageType" AS ENUM ('MATERIALS', 'CIVIL_WORKS', 'INSTALLATION', 'PROJECT_MANAGEMENT', 'LOGISTICS', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "CostElementCategory" AS ENUM ('DIRECT_MATERIAL', 'DIRECT_LABOR', 'EQUIPMENT', 'VEHICLE', 'SUBCONTRACTOR', 'INDIRECT_COST', 'FINANCIAL_COST', 'CORPORATE', 'PROFIT');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT', 'VEHICLE', 'SUBCONTRACT', 'SERVICE');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('VENDOR_QUOTE', 'SUBCONTRACTOR_QUOTE', 'ERP_PURCHASE_PRICE', 'HISTORICAL_RATE', 'INTERNAL_RATE', 'MARKET_BENCHMARK', 'MANUAL_ESTIMATE');

-- CreateTable
CREATE TABLE "CostingScenario" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostingScenarioType" NOT NULL DEFAULT 'MIXED_MODEL',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRateDate" TIMESTAMP(3),
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "CostingVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "previousVersionId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectionReason" TEXT,
    "totalCost" DECIMAL(18,2),
    "totalPrice" DECIMAL(18,2),
    "marginPercent" DECIMAL(6,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostPackage" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" "CostPackageType" NOT NULL DEFAULT 'OTHER',
    "ownerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "parentId" TEXT,
    "itemNumber" TEXT,
    "description" TEXT NOT NULL,
    "technicalDescription" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT,
    "customerRate" DECIMAL(18,4),
    "customerTotal" DECIMAL(18,2),
    "internalCost" DECIMAL(18,2),
    "sellingRate" DECIMAL(18,4),
    "sellingTotal" DECIMAL(18,2),
    "grossProfit" DECIMAL(18,2),
    "grossMargin" DECIMAL(6,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostBreakdown" (
    "id" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "elementId" TEXT,
    "resourceId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "wastePercent" DECIMAL(6,2),
    "productivityRate" DECIMAL(18,3),
    "durationDays" DECIMAL(10,2),
    "exchangeRate" DECIMAL(12,6),
    "taxAmount" DECIMAL(18,2),
    "allocationPercent" DECIMAL(6,2),
    "totalCost" DECIMAL(18,2) NOT NULL,
    "source" "CostSource" NOT NULL DEFAULT 'MANUAL_ESTIMATE',
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostElement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "CostElementCategory" NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFr" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CostElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "standardCost" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "country" TEXT,
    "orgUnitId" TEXT,
    "source" "CostSource" NOT NULL DEFAULT 'INTERNAL_RATE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostingScenario_opportunityId_idx" ON "CostingScenario"("opportunityId");

-- CreateIndex
CREATE INDEX "CostingScenario_isSelected_idx" ON "CostingScenario"("isSelected");

-- CreateIndex
CREATE INDEX "CostingVersion_scenarioId_idx" ON "CostingVersion"("scenarioId");

-- CreateIndex
CREATE INDEX "CostingVersion_status_idx" ON "CostingVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CostingVersion_scenarioId_versionNumber_key" ON "CostingVersion"("scenarioId", "versionNumber");

-- CreateIndex
CREATE INDEX "CostPackage_versionId_idx" ON "CostPackage"("versionId");

-- CreateIndex
CREATE INDEX "BoqItem_packageId_idx" ON "BoqItem"("packageId");

-- CreateIndex
CREATE INDEX "BoqItem_parentId_idx" ON "BoqItem"("parentId");

-- CreateIndex
CREATE INDEX "CostBreakdown_boqItemId_idx" ON "CostBreakdown"("boqItemId");

-- CreateIndex
CREATE INDEX "CostBreakdown_source_idx" ON "CostBreakdown"("source");

-- CreateIndex
CREATE UNIQUE INDEX "CostElement_code_key" ON "CostElement"("code");

-- CreateIndex
CREATE INDEX "CostElement_category_idx" ON "CostElement"("category");

-- CreateIndex
CREATE INDEX "Resource_code_idx" ON "Resource"("code");

-- CreateIndex
CREATE INDEX "Resource_type_idx" ON "Resource"("type");

-- CreateIndex
CREATE INDEX "Resource_effectiveFrom_effectiveTo_idx" ON "Resource"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_code_effectiveFrom_key" ON "Resource"("code", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "CostingScenario" ADD CONSTRAINT "CostingScenario_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingScenario" ADD CONSTRAINT "CostingScenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingVersion" ADD CONSTRAINT "CostingVersion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CostingScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingVersion" ADD CONSTRAINT "CostingVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "CostingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingVersion" ADD CONSTRAINT "CostingVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingVersion" ADD CONSTRAINT "CostingVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingVersion" ADD CONSTRAINT "CostingVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPackage" ADD CONSTRAINT "CostPackage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CostingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPackage" ADD CONSTRAINT "CostPackage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CostPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBreakdown" ADD CONSTRAINT "CostBreakdown_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBreakdown" ADD CONSTRAINT "CostBreakdown_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "CostElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBreakdown" ADD CONSTRAINT "CostBreakdown_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

