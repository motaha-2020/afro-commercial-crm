-- Release 7 — Award, Contracts and Handover.
--
-- "لا يجب اعتبار Verbal Award مساويًا لعقد موقع" — an award is a strength, not
-- a boolean, which is why AwardType has six values rather than a won flag.
--
-- The erpCostCode column on Award is the anchor for the ERP link: Afro opens a
-- code per opportunity under the project cost centre, and opens it AFTER the
-- award. Recording it here keeps actual cost traceable to its opportunity from
-- the moment the integration lands.

-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('VERBAL_AWARD', 'LETTER_OF_INTENT', 'PURCHASE_ORDER', 'CONTRACT_RECEIVED', 'CONTRACT_SIGNED', 'NOTICE_TO_PROCEED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('LUMP_SUM', 'UNIT_RATE', 'COST_PLUS', 'FRAMEWORK', 'SUPPLY_ONLY', 'SUPPLY_AND_INSTALL', 'SERVICE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'REVIEWED', 'SIGNED', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeviationField" AS ENUM ('PRICE', 'QUANTITIES', 'PAYMENT_TERMS', 'DURATION', 'WARRANTY', 'PENALTIES', 'LIABILITIES', 'TAXES', 'EXCLUSIONS', 'NEW_CLAUSE');

-- CreateEnum
CREATE TYPE "DeviationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'MITIGATED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'AWAITING_SIGNOFF', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HandoverCategory" AS ENUM ('CONTRACT', 'BOQ', 'COST_BASELINE', 'SCOPE', 'ASSUMPTIONS', 'EXCLUSIONS', 'RISKS', 'PAYMENT', 'SUPPLIERS', 'SUBCONTRACTORS', 'SCHEDULE', 'CUSTOMER_CONTACTS', 'DRAWINGS', 'PERMITS');

-- CreateEnum
CREATE TYPE "HandoverParty" AS ENUM ('SALES', 'COMMERCIAL', 'FINANCE', 'OPERATIONS', 'PROCUREMENT', 'PROJECT_MANAGER', 'LEGAL');

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "type" "AwardType" NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "awardedValue" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "customerReference" TEXT,
    "documentId" TEXT,
    "erpCostCode" TEXT,
    "erpCostCenter" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "awardId" TEXT,
    "accountId" TEXT NOT NULL,
    "proposalVersionId" TEXT,
    "contractNumber" TEXT,
    "legalEntity" TEXT,
    "type" "ContractType" NOT NULL DEFAULT 'LUMP_SUM',
    "contractValue" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "retentionPercent" DECIMAL(6,2),
    "advancePercent" DECIMAL(6,2),
    "warrantyMonths" INTEGER,
    "ldPercent" DECIMAL(6,2),
    "liabilityCap" DECIMAL(18,2),
    "governingLaw" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractClause" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL,
    "clauseText" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "owner" TEXT,
    "mitigation" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContractClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDeviation" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "field" "DeviationField" NOT NULL,
    "clauseName" TEXT,
    "proposalValue" TEXT,
    "contractValue" TEXT,
    "impact" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "DeviationStatus" NOT NULL DEFAULT 'OPEN',
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "isDetected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContractDeviation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectHandover" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "contractId" TEXT,
    "costBaselineVersionId" TEXT,
    "projectManagerId" TEXT,
    "plannedStartDate" TIMESTAMP(3),
    "handoverDate" TIMESTAMP(3),
    "status" "HandoverStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverItem" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "category" "HandoverCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "documentId" TEXT,
    "responsibleId" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "notApplicableReason" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HandoverItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverSignoff" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "party" "HandoverParty" NOT NULL,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "isAccepted" BOOLEAN,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HandoverSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Award_code_key" ON "Award"("code");

-- CreateIndex
CREATE INDEX "Award_opportunityId_idx" ON "Award"("opportunityId");

-- CreateIndex
CREATE INDEX "Award_type_idx" ON "Award"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_code_key" ON "Contract"("code");

-- CreateIndex
CREATE INDEX "Contract_opportunityId_idx" ON "Contract"("opportunityId");

-- CreateIndex
CREATE INDEX "Contract_accountId_idx" ON "Contract"("accountId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "ContractClause_contractId_idx" ON "ContractClause"("contractId");

-- CreateIndex
CREATE INDEX "ContractDeviation_contractId_idx" ON "ContractDeviation"("contractId");

-- CreateIndex
CREATE INDEX "ContractDeviation_status_idx" ON "ContractDeviation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectHandover_code_key" ON "ProjectHandover"("code");

-- CreateIndex
CREATE INDEX "ProjectHandover_opportunityId_idx" ON "ProjectHandover"("opportunityId");

-- CreateIndex
CREATE INDEX "ProjectHandover_status_idx" ON "ProjectHandover"("status");

-- CreateIndex
CREATE INDEX "HandoverItem_handoverId_idx" ON "HandoverItem"("handoverId");

-- CreateIndex
CREATE INDEX "HandoverItem_category_idx" ON "HandoverItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverSignoff_handoverId_party_key" ON "HandoverSignoff"("handoverId", "party");

-- CreateIndex
CREATE INDEX "HandoverSignoff_handoverId_idx" ON "HandoverSignoff"("handoverId");

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposalVersionId_fkey" FOREIGN KEY ("proposalVersionId") REFERENCES "ProposalVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractClause" ADD CONSTRAINT "ContractClause_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDeviation" ADD CONSTRAINT "ContractDeviation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDeviation" ADD CONSTRAINT "ContractDeviation_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDeviation" ADD CONSTRAINT "ContractDeviation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_costBaselineVersionId_fkey" FOREIGN KEY ("costBaselineVersionId") REFERENCES "CostingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverItem" ADD CONSTRAINT "HandoverItem_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ProjectHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverItem" ADD CONSTRAINT "HandoverItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverItem" ADD CONSTRAINT "HandoverItem_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverSignoff" ADD CONSTRAINT "HandoverSignoff_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ProjectHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverSignoff" ADD CONSTRAINT "HandoverSignoff_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
