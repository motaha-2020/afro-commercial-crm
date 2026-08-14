-- CreateEnum
CREATE TYPE "ScopeCategory" AS ENUM ('SUPPLY', 'DESIGN', 'CIVIL_WORKS', 'INSTALLATION', 'TESTING', 'ACCEPTANCE', 'MAINTENANCE', 'PROJECT_MANAGEMENT', 'LOGISTICS', 'OTHER');

-- CreateEnum
CREATE TYPE "ScopeInclusion" AS ENUM ('INCLUDED', 'EXCLUDED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "ScopePackageStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONFIRMED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "Responsibility" AS ENUM ('AFRO', 'CUSTOMER', 'SHARED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "AssumptionCategory" AS ENUM ('TECHNICAL', 'COMMERCIAL', 'SITE_ACCESS', 'PERMITS', 'CUSTOMER_INPUT', 'SCHEDULE', 'SUPPLY_CHAIN', 'OTHER');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('UNCONFIRMED', 'SENT_TO_CUSTOMER', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('OPEN', 'SENT', 'ANSWERED', 'CLOSED', 'UNANSWERED_AT_SUBMISSION');

-- CreateEnum
CREATE TYPE "ClarificationImpact" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKING');

-- CreateEnum
CREATE TYPE "BidType" AS ENUM ('PUBLIC_TENDER', 'PRIVATE_TENDER', 'RFQ', 'RFP', 'DIRECT_NEGOTIATION', 'FRAMEWORK_CALL_OFF', 'RENEWAL', 'CHANGE_REQUEST');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('IDENTIFIED', 'PREPARING', 'SUBMITTED', 'CLARIFICATION', 'AWARDED', 'LOST', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionMethod" AS ENUM ('PORTAL', 'EMAIL', 'HAND_DELIVERY', 'COURIER');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('TECHNICAL', 'COMMERCIAL', 'LEGAL', 'FINANCIAL', 'HSE', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY', 'SUBMITTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "BidDecision" AS ENUM ('BID', 'NO_BID', 'BID_WITH_CONDITIONS', 'HOLD');

-- CreateTable
CREATE TABLE "ScopePackage" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ScopeCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "responsibleTeam" TEXT,
    "inclusion" "ScopeInclusion" NOT NULL DEFAULT 'INCLUDED',
    "status" "ScopePackageStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScopePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,3),
    "unit" TEXT,
    "location" TEXT,
    "technicalSpecification" TEXT,
    "responsibility" "Responsibility" NOT NULL DEFAULT 'AFRO',
    "customerResponsibility" TEXT,
    "afroResponsibility" TEXT,
    "exclusion" TEXT,
    "acceptanceCriteria" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScopeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "scopeItemId" TEXT,
    "description" TEXT NOT NULL,
    "category" "AssumptionCategory" NOT NULL DEFAULT 'OTHER',
    "impactIfIncorrect" TEXT,
    "ownerId" TEXT,
    "confirmationStatus" "ConfirmationStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedAt" TIMESTAMP(3),
    "confirmationDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clarification" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "askedTo" TEXT,
    "askedAt" TIMESTAMP(3),
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "impact" "ClarificationImpact" NOT NULL DEFAULT 'NONE',
    "status" "ClarificationStatus" NOT NULL DEFAULT 'OPEN',
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Clarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "tenderNumber" TEXT,
    "type" "BidType" NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "issueDate" TIMESTAMP(3),
    "submissionDeadline" TIMESTAMP(3),
    "clarificationDeadline" TIMESTAMP(3),
    "bidBondRequired" BOOLEAN NOT NULL DEFAULT false,
    "bidBondAmount" DECIMAL(18,2),
    "bidBondCurrency" TEXT,
    "submissionMethod" "SubmissionMethod",
    "submittedAt" TIMESTAMP(3),
    "portalReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidRequirement" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "type" "RequirementType" NOT NULL DEFAULT 'ADMINISTRATIVE',
    "description" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "CompletionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BidRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidAssessment" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "suggestedDecision" "BidDecision" NOT NULL,
    "decision" "BidDecision",
    "decisionRationale" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "assessedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BidAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidScoringWeight" (
    "factor" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "BidScoringWeight_pkey" PRIMARY KEY ("factor")
);

-- CreateIndex
CREATE INDEX "ScopePackage_opportunityId_idx" ON "ScopePackage"("opportunityId");

-- CreateIndex
CREATE INDEX "ScopePackage_category_idx" ON "ScopePackage"("category");

-- CreateIndex
CREATE INDEX "ScopeItem_packageId_idx" ON "ScopeItem"("packageId");

-- CreateIndex
CREATE INDEX "ScopeItem_parentId_idx" ON "ScopeItem"("parentId");

-- CreateIndex
CREATE INDEX "Assumption_opportunityId_idx" ON "Assumption"("opportunityId");

-- CreateIndex
CREATE INDEX "Assumption_confirmationStatus_idx" ON "Assumption"("confirmationStatus");

-- CreateIndex
CREATE INDEX "Clarification_opportunityId_idx" ON "Clarification"("opportunityId");

-- CreateIndex
CREATE INDEX "Clarification_status_idx" ON "Clarification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_code_key" ON "Bid"("code");

-- CreateIndex
CREATE INDEX "Bid_opportunityId_idx" ON "Bid"("opportunityId");

-- CreateIndex
CREATE INDEX "Bid_status_idx" ON "Bid"("status");

-- CreateIndex
CREATE INDEX "Bid_submissionDeadline_idx" ON "Bid"("submissionDeadline");

-- CreateIndex
CREATE INDEX "BidRequirement_bidId_idx" ON "BidRequirement"("bidId");

-- CreateIndex
CREATE INDEX "BidRequirement_status_idx" ON "BidRequirement"("status");

-- CreateIndex
CREATE INDEX "BidAssessment_opportunityId_idx" ON "BidAssessment"("opportunityId");

-- AddForeignKey
ALTER TABLE "ScopePackage" ADD CONSTRAINT "ScopePackage_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ScopePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ScopeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ScopeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidRequirement" ADD CONSTRAINT "BidRequirement_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidRequirement" ADD CONSTRAINT "BidRequirement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidAssessment" ADD CONSTRAINT "BidAssessment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidAssessment" ADD CONSTRAINT "BidAssessment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidAssessment" ADD CONSTRAINT "BidAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

